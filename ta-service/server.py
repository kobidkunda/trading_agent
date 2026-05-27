import os
import json
import re
import asyncio
import traceback
import inspect
import time
from pathlib import Path
from contextlib import contextmanager
from datetime import date as date_cls
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Any
import httpx

from agent_reach import fetch_agent_reach_research
from finance_enrichment import fetch_finance_context
from tradingagents_runtime_patch import apply_tradingagents_runtime_patches, _normalize_ohlcv_columns

apply_tradingagents_runtime_patches()

app = FastAPI(title="TradingAgents API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TRADINGAGENTS_PROVIDER_LABELS = {
    "openai": "OpenAI",
    "google": "Google Gemini",
    "anthropic": "Anthropic Claude",
    "xai": "xAI Grok",
    "deepseek": "DeepSeek",
    "qwen": "Qwen",
    "qwen-cn": "Qwen China",
    "glm": "GLM",
    "glm-cn": "GLM China",
    "minimax": "MiniMax",
    "minimax-cn": "MiniMax China",
    "openrouter": "OpenRouter",
    "ollama": "Ollama",
    "azure": "Azure OpenAI",
}

TRADINGAGENTS_PROVIDER_ORDER = [
    "openai",
    "google",
    "anthropic",
    "xai",
    "deepseek",
    "qwen",
    "qwen-cn",
    "glm",
    "glm-cn",
    "minimax",
    "minimax-cn",
    "openrouter",
    "ollama",
    "azure",
]

LLM_FALLBACK_MODELS = [
    "frontier_flash",
    "frontier_lite",
    "deepseek_pro_paid",
]

LEGACY_MODEL_ALIASES = {
    "paper_proglm": "frontier_flash",
    "paper_lite": "frontier_lite",
}

LOCAL_LLM_PROXY_BASE_URL = "http://localhost:8100/v1"


class AnalyzeRequest(BaseModel):
    query: str
    date: Optional[str] = None
    depth: Optional[str] = "full"
    asset_type: Optional[str] = None
    llm_provider: Optional[str] = None
    deep_think_llm: Optional[str] = None
    quick_think_llm: Optional[str] = None
    max_debate_rounds: Optional[int] = None
    max_risk_discuss_rounds: Optional[int] = None
    output_language: Optional[str] = None
    checkpoint_enabled: Optional[bool] = None
    selected_analysts: Optional[list[str]] = None
    benchmark_ticker: Optional[str] = None
    benchmark_map: Optional[dict[str, str]] = None
    max_recur_limit: Optional[int] = None
    memory_log_max_entries: Optional[int] = None
    analyst_concurrency_limit: Optional[int] = None
    news_article_limit: Optional[int] = None
    global_news_article_limit: Optional[int] = None
    global_news_lookback_days: Optional[int] = None
    global_news_queries: Optional[list[str]] = None
    openai_reasoning_effort: Optional[str] = None
    google_thinking_level: Optional[str] = None
    anthropic_effort: Optional[str] = None
    data_vendors: Optional[dict[str, str]] = None
    tool_vendors: Optional[dict[str, str]] = None
    clear_checkpoints: Optional[bool] = None
    llm_base_url: Optional[str] = None
    llm_api_key: Optional[str] = None
    native_timeout_seconds: Optional[int] = None


class AnalyzeResponse(BaseModel):
    status: str
    query: str
    news_report: Optional[dict] = None
    sentiment_report: Optional[dict] = None
    technical_report: Optional[dict] = None
    fundamentals_report: Optional[dict] = None
    reddit_report: Optional[dict] = None
    x_report: Optional[dict] = None
    bull_debate: Optional[str] = None
    bear_debate: Optional[str] = None
    decision: Optional[str] = None
    confidence: Optional[float] = None
    raw_output: Optional[dict] = None
    error: Optional[str] = None


def _extract_agent_reach_social_evidence(agent_reach_result: Any) -> dict[str, Any] | None:
    if not isinstance(agent_reach_result, dict) or not agent_reach_result:
        return None
    if "error" in agent_reach_result:
        return {"error": agent_reach_result["error"]}

    social_keys = {
        "social",
        "social_evidence",
        "sentiment",
        "reddit",
        "x",
        "twitter",
        "posts",
        "sources",
        "evidence",
        "findings",
        "summary",
    }
    social_context = {
        key: value
        for key, value in agent_reach_result.items()
        if key in social_keys and value not in (None, [], {})
    }
    return social_context or {"research": agent_reach_result}


def _merge_social_context(
    reddit_posts: list[dict],
    x_posts: list[dict],
    agent_reach_result: Any,
) -> dict[str, Any] | None:
    agent_reach_social = _extract_agent_reach_social_evidence(agent_reach_result)
    if not reddit_posts and not x_posts and not agent_reach_social:
        return None

    social_context: dict[str, Any] = {}
    if reddit_posts:
        social_context["reddit"] = {"posts": reddit_posts}
    if x_posts:
        social_context["x"] = {"posts": x_posts}
    if agent_reach_social is not None:
        social_context["agent_reach"] = agent_reach_social
    return social_context


def get_llm_config(req: AnalyzeRequest) -> dict:
    base_url = (
        req.llm_base_url
        or os.getenv("TRADINGAGENTS_LLM_BACKEND_URL")
        or os.getenv("OPENAI_BASE_URL", "http://host.docker.internal:4444/v1")
    ).rstrip("/")
    api_key = (
        req.llm_api_key
        or os.getenv("TRADINGAGENTS_LLM_API_KEY")
        or os.getenv("LLM_API_KEY")
        or os.getenv("LITELLM_API_KEY")
        or os.getenv("OPENAI_API_KEY", "")
    )
    deep_model = (
        req.deep_think_llm
        or os.getenv("TA_DEEP_THINK_LLM")
        or os.getenv("TRADINGAGENTS_DEEP_THINK_LLM")
        or "frontier_flash"
    )
    quick_model = (
        req.quick_think_llm
        or os.getenv("TA_QUICK_THINK_LLM")
        or os.getenv("TRADINGAGENTS_QUICK_THINK_LLM")
        or "frontier_lite"
    )
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return {
        "base_url": base_url,
        "api_key": api_key,
        "deep_model": deep_model,
        "quick_model": quick_model,
        "headers": headers,
    }


def _upstream_llm_base_url(req: AnalyzeRequest | None = None) -> str:
    requested = req.llm_base_url if req is not None else None
    return (
        requested
        or os.getenv("TRADINGAGENTS_UPSTREAM_LLM_BACKEND_URL")
        or os.getenv("TRADINGAGENTS_LLM_BACKEND_URL")
        or os.getenv("OPENAI_BASE_URL")
        or os.getenv("LLM_BASE_URL")
        or os.getenv("LITELLM_BASE_URL")
        or "http://host.docker.internal:4444/v1"
    ).rstrip("/")


def _llm_proxy_enabled(req: AnalyzeRequest | None = None) -> bool:
    if req is not None and req.llm_base_url:
        return False
    value = os.getenv("TRADINGAGENTS_NORMALIZE_LLM_RESPONSES", "true").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _extract_first_json_value(text: str) -> Any:
    decoder = json.JSONDecoder()
    stripped = text.strip()
    if not stripped:
        raise ValueError("empty response body")

    for candidate in (stripped,):
        try:
            value, _ = decoder.raw_decode(candidate)
            return value
        except Exception:
            pass

    for match in re.finditer(r"[\{\[]", stripped):
        try:
            value, _ = decoder.raw_decode(stripped[match.start():])
            return value
        except Exception:
            continue
    raise ValueError("no JSON object found in response body")


def _parse_llm_response_payload(text: str) -> Any:
    stripped = text.strip()
    if not stripped:
        return {}

    if "data:" in stripped:
        events: list[Any] = []
        for line in stripped.splitlines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                events.append(_extract_first_json_value(data))
            except Exception:
                continue
        if events:
            if all(isinstance(item, dict) and item.get("object") == "chat.completion.chunk" for item in events):
                return _merge_chat_completion_chunks(events)
            return events[-1]

    return _extract_first_json_value(stripped)


def _merge_chat_completion_chunks(events: list[dict[str, Any]]) -> dict[str, Any]:
    first = events[0] if events else {}
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    finish_reason = None
    role = "assistant"

    for event in events:
        choices = event.get("choices") if isinstance(event, dict) else None
        if not isinstance(choices, list) or not choices:
            continue
        choice = choices[0] if isinstance(choices[0], dict) else {}
        finish_reason = choice.get("finish_reason") or finish_reason
        delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
        message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
        role = delta.get("role") or message.get("role") or role
        for source in (delta, message):
            content = source.get("content")
            if isinstance(content, str):
                content_parts.append(content)
            reasoning = source.get("reasoning_content")
            if isinstance(reasoning, str):
                reasoning_parts.append(reasoning)

    content = "".join(content_parts).strip() or "".join(reasoning_parts).strip()
    return {
        "id": first.get("id", "chatcmpl-normalized"),
        "object": "chat.completion",
        "created": first.get("created"),
        "model": first.get("model"),
        "choices": [
            {
                "index": 0,
                "finish_reason": finish_reason or "stop",
                "message": {
                    "role": role,
                    "content": content,
                },
            }
        ],
        "usage": first.get("usage") or {},
    }


def _normalize_chat_completion_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {
            "id": "chatcmpl-normalized",
            "object": "chat.completion",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": str(payload)},
                }
            ],
        }

    choices = payload.get("choices")
    if not isinstance(choices, list):
        return payload

    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict):
            delta = choice.get("delta")
            if isinstance(delta, dict):
                message = {
                    "role": delta.get("role", "assistant"),
                    "content": delta.get("content"),
                    "reasoning_content": delta.get("reasoning_content"),
                }
                choice["message"] = message
            else:
                continue
        content = message.get("content")
        reasoning = message.get("reasoning_content")
        if (content is None or content == "") and isinstance(reasoning, str) and reasoning.strip():
            message["content"] = reasoning
    return payload


def _response_json(payload: Any, status_code: int = 200) -> Response:
    return Response(
        content=json.dumps(payload, ensure_ascii=False),
        status_code=status_code,
        media_type="application/json",
    )


def _sanitize_upstream_error(text: str, limit: int = 1000) -> str:
    sanitized = re.sub(r"Bearer\s+[A-Za-z0-9._~+\-/=]+", "Bearer [redacted]", text or "")
    sanitized = re.sub(r"sk-[A-Za-z0-9._~+\-/=]+", "sk-[redacted]", sanitized)
    return sanitized[:limit]


def _retryable_upstream_status(status_code: int) -> bool:
    return status_code in {408, 409, 425, 429, 500, 502, 503, 504}


async def _post_upstream_llm_json(
    path: str,
    headers: dict[str, str],
    payload: Any,
    *,
    timeout_seconds: float | None = None,
    max_attempts: int | None = None,
) -> httpx.Response:
    last_response: httpx.Response | None = None
    last_error: Exception | None = None
    url = f"{_upstream_llm_base_url()}{path}"
    timeout = timeout_seconds or _env_float("TRADINGAGENTS_LLM_REQUEST_TIMEOUT_SECONDS", 45.0)
    attempts = max_attempts or _env_int("TRADINGAGENTS_LLM_REQUEST_MAX_ATTEMPTS", 2)

    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(1, attempts + 1):
            try:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code == 200 or not _retryable_upstream_status(response.status_code) or attempt == attempts:
                    return response
                last_response = response
                print(
                    "[LLMProxy] retrying upstream HTTP "
                    f"{response.status_code} for {path} attempt={attempt}/{attempts} timeout={timeout}s",
                    flush=True,
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                if attempt == attempts:
                    break
                print(
                    "[LLMProxy] retrying upstream transport error "
                    f"for {path} attempt={attempt}/{attempts} timeout={timeout}s: {_sanitize_upstream_error(str(exc), 300)}",
                    flush=True,
                )
            await asyncio.sleep(min(0.5 * attempt, 2.0))

    if last_response is not None:
        return last_response
    raise RuntimeError(_sanitize_upstream_error(str(last_error or "upstream LLM request failed")))


def _responses_content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = (
                    block.get("text")
                    or block.get("input_text")
                    or block.get("output_text")
                    or block.get("refusal")
                )
                if text is not None:
                    parts.append(str(text))
        return "\n".join(part for part in parts if part)
    return str(content)


def _responses_input_to_chat_messages(input_value: Any, instructions: Any = None) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    if instructions:
        messages.append({"role": "system", "content": str(instructions)})

    items = input_value if isinstance(input_value, list) else [{"role": "user", "content": input_value}]
    for item in items:
        if not isinstance(item, dict):
            messages.append({"role": "user", "content": str(item)})
            continue
        item_type = item.get("type")
        if item_type == "function_call_output":
            tool_message: dict[str, Any] = {
                "role": "tool",
                "content": _responses_content_to_text(item.get("output")),
            }
            call_id = item.get("call_id")
            if call_id:
                tool_message["tool_call_id"] = str(call_id)
            messages.append(tool_message)
            continue
        if item_type == "function_call":
            call_id = item.get("call_id") or item.get("id") or item.get("name") or "call_normalized"
            messages.append(
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": str(call_id),
                            "type": "function",
                            "function": {
                                "name": str(item.get("name") or "tool"),
                                "arguments": item.get("arguments") or "{}",
                            },
                        }
                    ],
                }
            )
            continue
        role = item.get("role") or ("assistant" if item_type == "message" else "user")
        if role not in {"system", "user", "assistant", "tool"}:
            role = "user"
        message: dict[str, Any] = {"role": role, "content": _responses_content_to_text(item.get("content"))}
        if role == "tool" and item.get("tool_call_id"):
            message["tool_call_id"] = str(item.get("tool_call_id"))
        messages.append(message)

    return [message for message in messages if message.get("content") or message.get("tool_calls")]


def _responses_tools_to_chat_tools(tools: Any) -> list[dict[str, Any]]:
    if not isinstance(tools, list):
        return []

    chat_tools: list[dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        if tool.get("type") != "function":
            continue
        if isinstance(tool.get("function"), dict):
            chat_tools.append(tool)
            continue
        name = tool.get("name")
        if not name:
            continue
        chat_tools.append(
            {
                "type": "function",
                "function": {
                    "name": str(name),
                    "description": str(tool.get("description") or ""),
                    "parameters": tool.get("parameters") or {},
                },
            }
        )
    return chat_tools


def _responses_tool_choice_to_chat_tool_choice(tool_choice: Any) -> Any:
    if isinstance(tool_choice, str):
        return tool_choice
    if not isinstance(tool_choice, dict):
        return None
    if tool_choice.get("type") == "function":
        name = tool_choice.get("name")
        if not name and isinstance(tool_choice.get("function"), dict):
            name = tool_choice["function"].get("name")
        if name:
            return {"type": "function", "function": {"name": str(name)}}
    return tool_choice


def _responses_payload_to_chat_payload(payload: dict[str, Any]) -> dict[str, Any]:
    chat_payload: dict[str, Any] = {
        "model": payload.get("model"),
        "messages": _responses_input_to_chat_messages(payload.get("input"), payload.get("instructions")),
        "stream": False,
    }
    if payload.get("temperature") is not None:
        chat_payload["temperature"] = payload.get("temperature")
    max_tokens = payload.get("max_output_tokens") or payload.get("max_tokens")
    if max_tokens is not None:
        chat_payload["max_tokens"] = max_tokens

    tools = _responses_tools_to_chat_tools(payload.get("tools"))
    if tools:
        chat_payload["tools"] = tools
        tool_choice = _responses_tool_choice_to_chat_tool_choice(payload.get("tool_choice"))
        if tool_choice is not None:
            chat_payload["tool_choice"] = tool_choice

    text_config = payload.get("text")
    if isinstance(text_config, dict):
        text_format = text_config.get("format")
        if isinstance(text_format, dict):
            if text_format.get("type") == "json_object":
                chat_payload["response_format"] = {"type": "json_object"}
            elif text_format.get("type") == "json_schema":
                chat_payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": text_format.get("name", "structured_response"),
                        "schema": text_format.get("schema", {}),
                        "strict": text_format.get("strict", False),
                    },
                }
    return chat_payload


def _extract_rating_like_value(text: str, allowed: list[str], default: str) -> str:
    if not text:
        return default
    allowed_by_lower = {item.lower(): item for item in allowed}
    label_match = re.search(
        r"(?:recommendation|rating|action)\s*[:\-]\s*\**\s*([A-Za-z]+)",
        text,
        flags=re.IGNORECASE,
    )
    if label_match:
        candidate = label_match.group(1).lower()
        if candidate in allowed_by_lower:
            return allowed_by_lower[candidate]
    for candidate_lower, candidate in allowed_by_lower.items():
        if re.search(rf"\b{re.escape(candidate_lower)}\b", text, flags=re.IGNORECASE):
            return candidate
    return default


def _schema_default_value(field_name: str, schema: dict[str, Any], content: str) -> Any:
    description = str(schema.get("description") or "")
    enum_values = schema.get("enum")
    if not isinstance(enum_values, list) and isinstance(schema.get("anyOf"), list):
        for option in schema["anyOf"]:
            if isinstance(option, dict) and isinstance(option.get("enum"), list):
                enum_values = option["enum"]
                break
    allowed = [str(item) for item in enum_values] if isinstance(enum_values, list) else []

    if field_name in {"recommendation", "rating"}:
        return _extract_rating_like_value(content, allowed or ["Buy", "Overweight", "Hold", "Underweight", "Sell"], "Hold")
    if field_name == "action":
        return _extract_rating_like_value(content, allowed or ["Buy", "Hold", "Sell"], "Hold")
    if schema.get("type") in {"number", "integer"} or any(
        isinstance(option, dict) and option.get("type") in {"number", "integer"}
        for option in schema.get("anyOf", [])
        if isinstance(option, dict)
    ):
        return None
    if field_name in {"rationale", "reasoning", "executive_summary", "investment_thesis", "strategic_actions"}:
        return content.strip() or description or "No additional rationale supplied."
    if field_name in {"position_sizing", "time_horizon"}:
        return None
    return content.strip() or description or ""


def _ensure_structured_response_text(content: str, request_payload: dict[str, Any]) -> str:
    text_config = request_payload.get("text")
    text_format = text_config.get("format") if isinstance(text_config, dict) else None
    if not isinstance(text_format, dict) or text_format.get("type") != "json_schema":
        return content

    schema = text_format.get("schema")
    if not isinstance(schema, dict):
        return content
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return content

    required = schema.get("required")
    required_fields = [field for field in required if isinstance(field, str)] if isinstance(required, list) else list(properties.keys())

    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict) and all(field in parsed and parsed[field] is not None for field in required_fields):
            return content
    except Exception:
        pass

    coerced: dict[str, Any] = {}
    for field_name, field_schema in properties.items():
        if not isinstance(field_schema, dict):
            field_schema = {}
        coerced[field_name] = _schema_default_value(field_name, field_schema, content)

    for field_name in required_fields:
        if field_name not in coerced or coerced[field_name] is None:
            coerced[field_name] = _schema_default_value(field_name, {}, content)

    return json.dumps(coerced, ensure_ascii=False)


def _structured_response_parsed_value(content: str, request_payload: dict[str, Any]) -> Any:
    text_config = request_payload.get("text")
    text_format = text_config.get("format") if isinstance(text_config, dict) else None
    if not isinstance(text_format, dict) or text_format.get("type") != "json_schema":
        return None
    try:
        parsed = json.loads(content)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _is_structured_json_schema_request(request_payload: dict[str, Any]) -> bool:
    text_config = request_payload.get("text")
    text_format = text_config.get("format") if isinstance(text_config, dict) else None
    return isinstance(text_format, dict) and text_format.get("type") == "json_schema"


def _tool_calls_to_structured_seed(tool_calls: Any) -> str:
    if not isinstance(tool_calls, list):
        return ""
    parts: list[str] = []
    for tool_call in tool_calls:
        if not isinstance(tool_call, dict):
            continue
        function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
        name = function.get("name") or tool_call.get("name")
        arguments = function.get("arguments") or tool_call.get("arguments")
        if name or arguments:
            parts.append(f"{name or 'tool'}: {arguments or ''}")
    return "\n".join(parts)


def _chat_tool_calls_to_responses_output(tool_calls: Any, response_id: str) -> list[dict[str, Any]]:
    if not isinstance(tool_calls, list):
        return []

    output: list[dict[str, Any]] = []
    for index, tool_call in enumerate(tool_calls):
        if not isinstance(tool_call, dict):
            continue
        function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
        name = function.get("name") or tool_call.get("name")
        if not name:
            continue
        call_id = tool_call.get("id") or tool_call.get("call_id") or f"call_{response_id}_{index}"
        arguments = function.get("arguments")
        if arguments is None:
            arguments = tool_call.get("arguments") or "{}"
        output.append(
            {
                "id": str(call_id),
                "type": "function_call",
                "status": "completed",
                "call_id": str(call_id),
                "name": str(name),
                "arguments": str(arguments),
            }
        )
    return output


def _chat_completion_to_responses_payload(chat_payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    choice = {}
    choices = chat_payload.get("choices")
    if isinstance(choices, list) and choices:
        choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
    response_id = chat_payload.get("id") or "resp_normalized"
    is_structured_request = _is_structured_json_schema_request(request_payload)
    tool_call_output = [] if is_structured_request else _chat_tool_calls_to_responses_output(message.get("tool_calls"), str(response_id))
    content = message.get("content")
    if content is None:
        content = message.get("reasoning_content") or ""
    if is_structured_request and not str(content or "").strip():
        content = _tool_calls_to_structured_seed(message.get("tool_calls"))
    content = _ensure_structured_response_text(str(content or ""), request_payload)
    parsed = _structured_response_parsed_value(content, request_payload)

    usage = chat_payload.get("usage") if isinstance(chat_payload.get("usage"), dict) else {}
    input_tokens = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
    output_tokens = usage.get("completion_tokens") or usage.get("output_tokens") or 0
    total_tokens = usage.get("total_tokens") or input_tokens + output_tokens

    created = chat_payload.get("created") or int(time.time())
    model = chat_payload.get("model") or request_payload.get("model")
    content_block: dict[str, Any] = {
        "type": "output_text",
        "text": str(content or ""),
        "annotations": [],
    }
    if parsed is not None:
        content_block["parsed"] = parsed

    output = tool_call_output
    if not output:
        output = [
            {
                "id": f"msg_{response_id}",
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [content_block],
            }
        ]

    return {
        "id": str(response_id).replace("chatcmpl", "resp", 1),
        "object": "response",
        "created_at": created,
        "status": "completed",
        "error": None,
        "incomplete_details": None,
        "instructions": request_payload.get("instructions"),
        "metadata": request_payload.get("metadata") or {},
        "model": model,
        "output": output,
        "output_text": str(content or ""),
        "parallel_tool_calls": True,
        "temperature": request_payload.get("temperature"),
        "tool_choice": request_payload.get("tool_choice", "auto"),
        "tools": request_payload.get("tools") or [],
        "top_p": request_payload.get("top_p"),
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
        },
        "text": request_payload.get("text"),
    }


def _today_iso() -> str:
    return date_cls.today().isoformat()


def _log_phase(label: str, **fields: Any) -> None:
    safe_fields = {
        key: value
        for key, value in fields.items()
        if key not in {"api_key", "llm_api_key"} and value is not None
    }
    suffix = f" {json.dumps(safe_fields, default=str, ensure_ascii=False)}" if safe_fields else ""
    print(f"[NativeGraph] {label}{suffix}", flush=True)


def _build_tradingagents_config(req: AnalyzeRequest, default_config: dict[str, Any]) -> dict[str, Any]:
    data_dir = Path(os.getenv("TRADINGAGENTS_DATA_DIR", "/app/data"))
    data_dir.mkdir(parents=True, exist_ok=True)

    config = default_config.copy()
    config["data_cache_dir"] = str(data_dir / "cache")
    config["results_dir"] = str(data_dir / "logs")
    config["memory_log_path"] = str(data_dir / "memory" / "trading_memory.md")
    config["llm_provider"] = (
        req.llm_provider
        or os.getenv("TA_LLM_PROVIDER")
        or os.getenv("TRADINGAGENTS_LLM_PROVIDER")
        or config.get("llm_provider")
        or "openai"
    )

    base_url = LOCAL_LLM_PROXY_BASE_URL if _llm_proxy_enabled(req) else _upstream_llm_base_url(req)
    if not base_url:
        base_url = config.get("backend_url")
    if base_url:
        config["backend_url"] = str(base_url).rstrip("/")

    config["deep_think_llm"] = (
        req.deep_think_llm
        or os.getenv("TA_DEEP_THINK_LLM")
        or os.getenv("TRADINGAGENTS_DEEP_THINK_LLM")
        or config.get("deep_think_llm")
        or "gpt-5.4"
    )
    config["quick_think_llm"] = (
        req.quick_think_llm
        or os.getenv("TA_QUICK_THINK_LLM")
        or os.getenv("TRADINGAGENTS_QUICK_THINK_LLM")
        or config.get("quick_think_llm")
        or "gpt-5.4-mini"
    )

    if req.max_debate_rounds is not None:
        config["max_debate_rounds"] = req.max_debate_rounds
    if req.max_risk_discuss_rounds is not None:
        config["max_risk_discuss_rounds"] = req.max_risk_discuss_rounds
    if req.output_language:
        config["output_language"] = req.output_language
    if req.checkpoint_enabled is not None:
        config["checkpoint_enabled"] = req.checkpoint_enabled
    if req.benchmark_ticker:
        config["benchmark_ticker"] = req.benchmark_ticker
    if req.benchmark_map:
        config["benchmark_map"] = {
            **(config.get("benchmark_map") or {}),
            **req.benchmark_map,
        }
    if req.max_recur_limit is not None:
        config["max_recur_limit"] = req.max_recur_limit
    if req.memory_log_max_entries is not None:
        config["memory_log_max_entries"] = req.memory_log_max_entries
    if req.analyst_concurrency_limit is not None:
        config["analyst_concurrency_limit"] = req.analyst_concurrency_limit
    if req.news_article_limit is not None:
        config["news_article_limit"] = req.news_article_limit
    if req.global_news_article_limit is not None:
        config["global_news_article_limit"] = req.global_news_article_limit
    if req.global_news_lookback_days is not None:
        config["global_news_lookback_days"] = req.global_news_lookback_days
    if req.global_news_queries:
        config["global_news_queries"] = req.global_news_queries
    if req.openai_reasoning_effort:
        config["openai_reasoning_effort"] = req.openai_reasoning_effort
    if req.google_thinking_level:
        config["google_thinking_level"] = req.google_thinking_level
    if req.anthropic_effort:
        config["anthropic_effort"] = req.anthropic_effort
    if req.data_vendors:
        config["data_vendors"] = {
            **(config.get("data_vendors") or {}),
            **req.data_vendors,
        }
    if req.tool_vendors:
        config["tool_vendors"] = {
            **(config.get("tool_vendors") or {}),
            **req.tool_vendors,
        }

    return config


PROVIDER_API_KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
    "azure": "AZURE_OPENAI_API_KEY",
    "xai": "XAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "qwen": "DASHSCOPE_API_KEY",
    "qwen-cn": "DASHSCOPE_CN_API_KEY",
    "glm": "ZHIPU_API_KEY",
    "glm-cn": "ZHIPU_CN_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


@contextmanager
def _forwarded_provider_api_key(provider: str | None, api_key: str | None):
    env_name = PROVIDER_API_KEY_ENV.get((provider or "openai").lower())
    if not env_name or not api_key:
        yield
        return

    previous = os.environ.get(env_name)
    os.environ[env_name] = api_key
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(env_name, None)
        else:
            os.environ[env_name] = previous


def _infer_asset_type(query: str, ticker: str, requested: str | None = None) -> str:
    if requested in {"stock", "crypto"}:
        return requested
    haystack = f"{query} {ticker}".lower()
    crypto_terms = {"btc", "bitcoin", "eth", "ethereum", "sol", "solana", "crypto", "token"}
    return "crypto" if any(term in haystack for term in crypto_terms) else "stock"


def _as_report(value: Any) -> dict[str, Any] | None:
    if value in (None, "", [], {}):
        return None
    if isinstance(value, dict):
        return value
    return {"content": str(value)}


def _json_safe(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except TypeError:
        if isinstance(value, dict):
            return {str(k): _json_safe(v) for k, v in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [_json_safe(item) for item in value]
        return str(value)


def _rating_metrics(signal: str) -> tuple[float | None, float | None]:
    rating = (signal or "").strip().lower()
    probability_by_rating = {
        "buy": 0.65,
        "overweight": 0.58,
        "hold": 0.5,
        "underweight": 0.42,
        "sell": 0.35,
    }
    probability = probability_by_rating.get(rating)
    confidence = 0.6 if probability is not None and rating != "hold" else 0.5 if probability is not None else None
    return confidence, probability


def _propagate_graph(graph: Any, ticker: str, trade_date: str, asset_type: str):
    propagate = graph.propagate
    try:
        params = inspect.signature(propagate).parameters
        if "asset_type" in params:
            return propagate(ticker, trade_date, asset_type=asset_type)
    except (TypeError, ValueError):
        pass
    return propagate(ticker, trade_date)


def _selected_analysts(req: AnalyzeRequest) -> list[str]:
    valid = {"market", "social", "news", "fundamentals"}
    requested = req.selected_analysts or ["market", "social", "news", "fundamentals"]
    selected = []
    for analyst in requested:
        normalized = str(analyst).strip().lower()
        if normalized in valid and normalized not in selected:
            selected.append(normalized)
    return selected or ["market", "social", "news", "fundamentals"]


def _get_tradingagents_catalog() -> dict[str, dict[str, list[tuple[str, str]]]]:
    """Load the installed TradingAgents model catalog, falling back to stable provider defaults."""
    try:
        from tradingagents.llm_clients.model_catalog import MODEL_OPTIONS

        if isinstance(MODEL_OPTIONS, dict):
            return MODEL_OPTIONS
    except Exception as e:
        print(f"[Models] TradingAgents catalog import failed: {e}")
    return {}


def _metadata_option(option_id: str, label: str | None = None) -> dict[str, str]:
    cleaned_id = str(option_id or "").strip()
    cleaned_label = str(label or cleaned_id).strip() or cleaned_id
    return {"id": cleaned_id, "label": cleaned_label}


def _append_unique_option(options: list[dict[str, str]], option_id: Any, label: Any = None) -> None:
    cleaned_id = str(option_id or "").strip()
    if not cleaned_id or cleaned_id == "custom":
        return
    if any(item["id"] == cleaned_id for item in options):
        return
    options.append(_metadata_option(cleaned_id, str(label or cleaned_id)))


def _parse_model_records(payload: Any) -> list[dict[str, str]]:
    """Normalize OpenAI-compatible /models responses from data[], models[], or flat arrays."""
    if not isinstance(payload, dict):
        return []

    raw_models = payload.get("data")
    if raw_models is None:
        raw_models = payload.get("models")
    if raw_models is None:
        raw_models = payload.get("model")

    if not isinstance(raw_models, list):
        return []

    models: list[dict[str, str]] = []
    for item in raw_models:
        if isinstance(item, str):
            _append_unique_option(models, item, item)
            continue
        if isinstance(item, dict):
            model_id = item.get("id") or item.get("name") or item.get("model")
            label = item.get("name") or item.get("label") or item.get("id") or item.get("model")
            _append_unique_option(models, model_id, label)
    return models


async def _fetch_backend_models(cfg: dict) -> tuple[list[dict[str, str]], str | None]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{_upstream_llm_base_url()}/models", headers=cfg["headers"])
            if resp.status_code != 200:
                return [], f"HTTP {resp.status_code}"
            models = _parse_model_records(resp.json())
            if not models:
                return [], "Backend /models returned no usable model ids"
            return models, None
    except Exception as e:
        return [], str(e)


def _catalog_providers(catalog: dict[str, dict[str, list[tuple[str, str]]]]) -> list[dict[str, str]]:
    providers: list[dict[str, str]] = []
    for provider in TRADINGAGENTS_PROVIDER_ORDER:
        if provider in catalog or provider in TRADINGAGENTS_PROVIDER_LABELS:
            _append_unique_option(providers, provider, TRADINGAGENTS_PROVIDER_LABELS.get(provider, provider))
    for provider in sorted(catalog.keys()):
        _append_unique_option(providers, provider, TRADINGAGENTS_PROVIDER_LABELS.get(provider, provider))
    return providers


def _catalog_models(
    catalog: dict[str, dict[str, list[tuple[str, str]]]],
    selected_provider: str,
) -> list[dict[str, str]]:
    models: list[dict[str, str]] = []
    selected_catalog = catalog.get(selected_provider, {})
    catalog_sources = [selected_catalog] if selected_catalog else list(catalog.values())

    for mode_options in catalog_sources:
        if not isinstance(mode_options, dict):
            continue
        for options in mode_options.values():
            if not isinstance(options, list):
                continue
            for option in options:
                if not isinstance(option, (list, tuple)) or len(option) < 2:
                    continue
                label, model_id = option[0], option[1]
                _append_unique_option(models, model_id, label)

    for env_name in ("TA_DEEP_THINK_LLM", "TA_QUICK_THINK_LLM", "TRADINGAGENTS_DEEP_THINK_LLM", "TRADINGAGENTS_QUICK_THINK_LLM"):
        _append_unique_option(models, os.getenv(env_name), os.getenv(env_name))

    return models


def extract_ticker(query: str) -> str:
    q = query.upper()
    known = {
        "BITCOIN": "BTC",
        "BTC": "BTC",
        "ETHEREUM": "ETH",
        "ETH": "ETH",
        "APPLE": "AAPL",
        "TESLA": "TSLA",
        "GOOGLE": "GOOG",
        "AMAZON": "AMZN",
        "META": "META",
        "MICROSOFT": "MSFT",
        "NVIDIA": "NVDA",
        "SPY": "SPY",
        "NASDAQ": "QQQ",
        "S&P": "SPY",
        "CRYPTO": "BTC",
        "O SCAR": "MKT",
        "SENATE": "SPY",
        "NBA": "SPY",
        "POLITICS": "SPY",
        "ELECTION": "SPY",
    }
    for kw, ticker in known.items():
        if kw.upper() in q:
            return ticker

    explicit_symbol_matches = re.findall(
        r"(?<![A-Z0-9])(?:\$)?(\^?[A-Z]{1,5}\.[A-Z]{1,3}|\d{4}(?:\.[A-Z]{1,3})?)(?![A-Z0-9])",
        q,
    )
    if explicit_symbol_matches:
        return explicit_symbol_matches[0].strip("$")[:10]

    ticker_stopwords = {
        "ANALY",
        "WILL",
        "DOES",
        "DID",
        "CAN",
        "COULD",
        "SHOULD",
        "WOULD",
        "ABOUT",
        "ABOVE",
        "BELOW",
        "AFTER",
        "BEFORE",
        "OUTPERFORM",
        "UNDERPERFORM",
        "WEEK",
        "MONTH",
        "YEAR",
        "MARKET",
        "MARKETS",
        "STOCK",
        "STOCKS",
        "SHARE",
        "SHARES",
        "PRICE",
        "TRADE",
        "TRADING",
        "ANALYZE",
        "ANALYSIS",
    }
    symbol_matches = re.findall(
        r"(?<![A-Z0-9])(?:\$)?(\^?[A-Z]{1,5}(?:\.[A-Z]{1,3})?|\d{4}(?:\.[A-Z]{1,3})?)(?![A-Z0-9])",
        q,
    )
    for symbol in symbol_matches:
        clean_symbol = symbol.strip("$")
        if clean_symbol and clean_symbol not in ticker_stopwords:
            return clean_symbol[:10]
    return "MKT"


SOCIAL_STOPWORDS = {
    "will", "close", "above", "below", "over", "under", "market", "markets",
    "polymarket", "kalshi", "yes", "no", "the", "and", "for", "with", "that",
    "this", "from", "into", "june", "july", "august", "september", "october",
    "november", "december", "january", "february", "march", "april", "may",
}


def _social_keywords(query: str) -> set[str]:
    ticker = extract_ticker(query)
    keywords = set()
    for word in re.findall(r"[A-Za-z0-9$]{3,}", query):
        normalized = word.lower()
        if normalized in SOCIAL_STOPWORDS:
            continue
        if normalized.isdigit() and (1900 <= int(normalized) <= 2100):
            continue
        keywords.add(normalized)
    if ticker and ticker != "MKT":
        keywords.add(ticker.lower())
    if "bitcoin" in query.lower() or "btc" in query.lower():
        keywords.update({"bitcoin", "btc"})
    if "ethereum" in query.lower() or "eth" in query.lower():
        keywords.update({"ethereum", "eth"})
    return keywords


def _parse_llm_json(content: str) -> dict[str, Any]:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except Exception:
        pass

    starts = [idx for idx in (cleaned.find("{"), cleaned.find("[")) if idx >= 0]
    if starts:
        decoder = json.JSONDecoder()
        try:
            parsed, _ = decoder.raw_decode(cleaned[min(starts):])
            if isinstance(parsed, dict):
                return parsed
            return {"items": parsed}
        except Exception:
            pass
    return {"raw": content}


def _is_relevant_social_item(query: str, item: dict[str, Any]) -> bool:
    keywords = _social_keywords(query)
    if not keywords:
        return True
    haystack = " ".join(str(item.get(key, "")) for key in ("title", "selftext", "content", "subreddit", "url")).lower()
    return any(keyword in haystack for keyword in keywords)


# ── Reddit Data Fetching ─────────────────────────────────────────────────────

REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", "")
REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "TradingBot/1.0")
REDDIT_USERNAME = os.getenv("REDDIT_USERNAME", "")
REDDIT_PASSWORD = os.getenv("REDDIT_PASSWORD", "")


async def get_reddit_token() -> Optional[str]:
    if not REDDIT_CLIENT_ID or not REDDIT_CLIENT_SECRET:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            auth = httpx.BasicAuth(REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET)
            data = (
                {
                    "grant_type": "password",
                    "username": REDDIT_USERNAME,
                    "password": REDDIT_PASSWORD,
                }
                if REDDIT_USERNAME
                else {"grant_type": "client_credentials"}
            )
            headers = {"User-Agent": REDDIT_USER_AGENT}
            resp = await client.post(
                "https://www.reddit.com/api/v1/access_token",
                auth=auth,
                data=data,
                headers=headers,
            )
            if resp.status_code == 200:
                return resp.json().get("access_token")
    except Exception as e:
        print(f"[Reddit] Token error: {e}")
    return None


async def fetch_reddit_posts(query: str, max_posts: int = 100) -> list[dict]:
    """Fetch Reddit posts with high-volume targeting (300-500 total sources across all providers)."""
    token = await get_reddit_token()
    
    # Multiple search strategies for comprehensive coverage
    search_strategies = [
        # Main search - relevance sorted
        {"q": query, "sort": "relevance", "t": "month", "limit": min(100, max_posts)},
        # Hot discussions
        {"q": query, "sort": "hot", "t": "week", "limit": min(50, max_posts // 2)},
        # Comment-heavy discussions
        {"q": f"{query} comments:", "sort": "comments", "t": "month", "limit": min(50, max_posts // 2)},
    ]
    
    posts = []
    seen_urls = set()
    
    for strategy in search_strategies:
        if len(posts) >= max_posts:
            break
            
        try:
            if token:
                search_url = f"https://oauth.reddit.com/search?q={strategy['q']}&sort={strategy['sort']}&t={strategy['t']}&limit={strategy['limit']}"
                headers = {"Authorization": f"Bearer {token}", "User-Agent": REDDIT_USER_AGENT}
            else:
                search_url = f"https://www.reddit.com/search.json?q={strategy['q']}&sort={strategy['sort']}&t={strategy['t']}&limit={strategy['limit']}"
                headers = {"User-Agent": REDDIT_USER_AGENT}
            
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(search_url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    children = data.get("data", {}).get("children", [])
                    for child in children:
                        post = child.get("data", {})
                        url = f"https://reddit.com{post.get('permalink', '')}"
                        item = {
                            "title": post.get("title", ""),
                            "subreddit": post.get("subreddit", ""),
                            "score": post.get("score", 0),
                            "num_comments": post.get("num_comments", 0),
                            "created_utc": post.get("created_utc", 0),
                            "selftext": (post.get("selftext", "") or "")[:1000],
                            "url": url,
                            "upvote_ratio": post.get("upvote_ratio", 0.5),
                        }
                        if url not in seen_urls and _is_relevant_social_item(query, item):
                            seen_urls.add(url)
                            posts.append(item)
                            if len(posts) >= max_posts:
                                break
        except Exception as e:
            print(f"[Reddit] Strategy {strategy['sort']} error: {e}")
            continue

    # Expanded subreddit coverage for financial/political markets
    subreddits = [
        "wallstreetbets", "options", "stocks", "investing", "stockmarket",
        "cryptocurrency", "bitcoin", "ethereum", "defi",
        "politics", "politicaldiscussion", "news", "worldnews",
        "predictionmarket", "forex", "economy", "business",
        "technology", "technews", "futurology",
        "sportsbetting", "gambling", "fantasyfootball", "nba", "nfl",
    ]
    
    # Extract keywords for subreddit search
    keywords = [w.lower() for w in re.findall(r"[A-Za-z]+", query) if len(w) > 2]
    if not keywords:
        keywords = [query.lower()[:30]]
    
    # Search top subreddits
    for sub in subreddits[:10]:  # Increased from 3 to 10 subreddits
        if len(posts) >= max_posts:
            break
            
        try:
            sub_url = f"https://www.reddit.com/r/{sub}/search.json?q={'+'.join(keywords[:5])}&sort=hot&t=month&limit=10"
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(sub_url, headers={"User-Agent": REDDIT_USER_AGENT})
                if resp.status_code == 200:
                    for child in resp.json().get("data", {}).get("children", []):
                        post = child.get("data", {})
                        url = f"https://reddit.com{post.get('permalink', '')}"
                        item = {
                            "title": post.get("title", ""),
                            "subreddit": post.get("subreddit", sub),
                            "score": post.get("score", 0),
                            "num_comments": post.get("num_comments", 0),
                            "created_utc": post.get("created_utc", 0),
                            "selftext": (post.get("selftext", "") or "")[:1000],
                            "url": url,
                            "upvote_ratio": post.get("upvote_ratio", 0.5),
                        }
                        if url not in seen_urls and _is_relevant_social_item(query, item):
                            seen_urls.add(url)
                            posts.append(item)
                            if len(posts) >= max_posts:
                                break
        except Exception as e:
            print(f"[Reddit] r/{sub} error: {e}")
            continue

    print(f"[Reddit] Fetched {len(posts)} posts (target: {max_posts})")
    return posts[:max_posts]


# ── X/Twitter Data Fetching via SearXNG ─────────────────────────────────────

SEARXNG_URL = os.getenv(
    "TA_SEARXNG_URL", os.getenv("SEARXNG_URL", "http://192.168.88.97:8888")
)


async def fetch_x_posts(query: str, max_results: int = 100) -> list[dict]:
    """Fetch X/Twitter posts via SearXNG with multiple search strategies for high-volume results."""
    posts = []
    seen_urls = set()
    
    # Multiple search strategies for comprehensive coverage
    search_strategies = [
        # Direct X/Twitter site search
        {
            "q": f"{query} site:x.com OR site:twitter.com",
            "categories": "general,news,social media",
            "limit": min(50, max_results),
        },
        # Hashtag variations
        {
            "q": f"#{query.replace(' ', '')} OR #{query.replace(' ', '_')} site:x.com",
            "categories": "social media",
            "limit": min(30, max_results // 2),
        },
        # Keywords without quotes for broader match
        {
            "q": f"{query} (breaking OR news OR update OR analysis) site:x.com",
            "categories": "news,social media",
            "limit": min(30, max_results // 2),
        },
        # Recent discussions
        {
            "q": f"{query} lang:en site:x.com",
            "categories": "social media",
            "time_range": "day",
            "limit": min(20, max_results // 3),
        },
    ]
    
    for i, strategy in enumerate(search_strategies):
        if len(posts) >= max_results:
            break
            
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                params = {
                    "q": strategy["q"],
                    "format": "json",
                    "categories": strategy["categories"],
                    "language": "en",
                }
                if "time_range" in strategy:
                    params["time_range"] = strategy["time_range"]
                if "limit" in strategy:
                    params["max_results"] = strategy["limit"]
                    
                resp = await client.get(
                    f"{SEARXNG_URL}/search",
                    params=params,
                    headers={"Accept": "application/json"},
                )
                
                if resp.status_code == 200:
                    data = resp.json()
                    results = data.get("results", [])
                    print(f"[X/SearXNG] Strategy {i+1}: {len(results)} raw results")
                    
                    for item in results:
                        url = item.get("url", "")
                        if ("x.com" in url or "twitter.com" in url) and url not in seen_urls and _is_relevant_social_item(query, item):
                            seen_urls.add(url)
                            posts.append(
                                {
                                    "title": item.get("title", ""),
                                    "url": url,
                                    "content": (item.get("content", "") or "")[:1000],
                                    "engine": item.get("engine", "searxng"),
                                    "author": item.get("author", ""),
                                    "publishedDate": item.get("publishedDate", ""),
                                }
                            )
                            if len(posts) >= max_results:
                                break
        except Exception as e:
            print(f"[X/SearXNG] Strategy {i+1} error: {e}")
            continue
    
    print(f"[X/Twitter] Fetched {len(posts)} posts via SearXNG (target: {max_results})")
    return posts[:max_results]


# ── LLM Chat ────────────────────────────────────────────────────────────────


async def llm_chat(
    base_url: str,
    headers: dict,
    model: str,
    system: str,
    user: str,
    temperature: float = 0.3,
) -> Optional[dict]:
    models_to_try = []
    primary_model = LEGACY_MODEL_ALIASES.get(model, model)
    for candidate in [primary_model, *LLM_FALLBACK_MODELS]:
        if candidate and candidate not in models_to_try:
            models_to_try.append(candidate)

    errors: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            for candidate_model in models_to_try:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": candidate_model,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "temperature": temperature,
                        "max_tokens": 1500,
                    },
                )
                if resp.status_code == 200:
                    response_text = resp.text
                    try:
                        data = json.loads(response_text)
                        content = (
                            data.get("choices", [{}])[0].get("message", {}).get("content", "")
                        )
                    except Exception as e:
                        content_match = re.search(r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"', response_text)
                        if not content_match:
                            errors.append(f"{candidate_model}: invalid JSON response: {e}")
                            continue
                        try:
                            content = json.loads(f'"{content_match.group(1)}"')
                        except Exception:
                            content = content_match.group(1).replace("\\n", "\n").replace('\\"', '"')
                    if not content.strip():
                        errors.append(f"{candidate_model}: empty response content")
                        continue
                    return _parse_llm_json(content)
                body = resp.text[:300] if resp.text else ""
                errors.append(f"{candidate_model}: HTTP {resp.status_code}{f' {body}' if body else ''}")
        return {"error": "; ".join(errors) or "LLM call failed"}
    except Exception as e:
        return {"error": str(e)}


# ── Endpoints ────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    installed_version = None
    try:
        from importlib.metadata import version
        installed_version = version("tradingagents")
    except Exception:
        installed_version = None
    return {
        "status": "healthy",
        "service": "tradingagents-api",
        "version": "2.0.0",
        "tradingagents_version": installed_version,
    }


@app.get("/models")
async def list_models():
    cfg = get_llm_config(AnalyzeRequest(query="test"))
    provider = os.getenv("TA_LLM_PROVIDER") or os.getenv("TRADINGAGENTS_LLM_PROVIDER") or "openai"
    catalog = _get_tradingagents_catalog()
    providers = _catalog_providers(catalog)
    catalog_models = _catalog_models(catalog, provider)
    backend_models, backend_error = await _fetch_backend_models(cfg)

    models: list[dict[str, str]] = []
    for option in backend_models + catalog_models:
        _append_unique_option(models, option["id"], option.get("label") or option["id"])

    response: dict[str, Any] = {
        "providers": providers,
        "models": models,
        "defaults": {
            "provider": provider,
            "deep_think_llm": cfg["deep_model"],
            "quick_think_llm": cfg["quick_model"],
        },
        "backend": {
            "base_url": cfg["base_url"],
            "reachable": backend_error is None,
            "model_count": len(backend_models),
        },
    }
    if backend_error:
        response["warning"] = f"Live backend model probe failed: {backend_error}"
    return response


@app.get("/v1/models")
async def proxy_openai_models(request: Request):
    cfg = get_llm_config(AnalyzeRequest(query="models"))
    headers = dict(cfg["headers"])
    auth_header = request.headers.get("authorization")
    if auth_header:
        headers["Authorization"] = auth_header
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            upstream = await client.get(f"{_upstream_llm_base_url()}/models", headers=headers)
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "application/json").split(";")[0],
        )
    except Exception as e:
        return _response_json({"error": str(e)}, status_code=502)


@app.post("/v1/chat/completions")
async def proxy_openai_chat_completions(request: Request):
    cfg = get_llm_config(AnalyzeRequest(query="chat"))
    headers = dict(cfg["headers"])
    auth_header = request.headers.get("authorization")
    if auth_header:
        headers["Authorization"] = auth_header

    try:
        payload = await request.json()
    except Exception as e:
        return _response_json({"error": f"Invalid JSON request: {e}"}, status_code=400)

    if isinstance(payload, dict):
        payload = payload.copy()
        payload["stream"] = False

    try:
        upstream = await _post_upstream_llm_json("/chat/completions", headers, payload)
        response_text = upstream.text
        if upstream.status_code != 200:
            try:
                error_payload = _parse_llm_response_payload(response_text)
            except Exception:
                error_payload = {"error": _sanitize_upstream_error(response_text) or f"HTTP {upstream.status_code}"}
            print(
                "[LLMProxy] upstream chat failed "
                f"status={upstream.status_code} body={_sanitize_upstream_error(response_text, 300)}",
                flush=True,
            )
            return _response_json(error_payload, status_code=upstream.status_code)

        parsed = _parse_llm_response_payload(response_text)
        normalized = _normalize_chat_completion_payload(parsed)
        return _response_json(normalized)
    except Exception as e:
        error = _sanitize_upstream_error(str(e))
        print(f"[LLMProxy] upstream chat exception: {error}", flush=True)
        return _response_json({"error": error}, status_code=502)


@app.post("/v1/responses")
async def proxy_openai_responses(request: Request):
    cfg = get_llm_config(AnalyzeRequest(query="responses"))
    headers = dict(cfg["headers"])
    auth_header = request.headers.get("authorization")
    if auth_header:
        headers["Authorization"] = auth_header

    try:
        payload = await request.json()
    except Exception as e:
        return _response_json({"error": f"Invalid JSON request: {e}"}, status_code=400)
    if not isinstance(payload, dict):
        return _response_json({"error": "Responses request must be a JSON object"}, status_code=400)

    chat_payload = _responses_payload_to_chat_payload(payload)
    if not chat_payload.get("messages"):
        return _response_json({"error": "Responses request did not contain usable input messages"}, status_code=400)

    try:
        upstream = await _post_upstream_llm_json("/chat/completions", headers, chat_payload)
        response_text = upstream.text
        if upstream.status_code != 200:
            try:
                error_payload = _parse_llm_response_payload(response_text)
            except Exception:
                error_payload = {"error": _sanitize_upstream_error(response_text) or f"HTTP {upstream.status_code}"}
            print(
                "[LLMProxy] upstream responses failed "
                f"status={upstream.status_code} body={_sanitize_upstream_error(response_text, 300)}",
                flush=True,
            )
            return _response_json(error_payload, status_code=upstream.status_code)

        parsed = _parse_llm_response_payload(response_text)
        normalized = _normalize_chat_completion_payload(parsed)
        return _response_json(_chat_completion_to_responses_payload(normalized, payload))
    except Exception as e:
        error = _sanitize_upstream_error(str(e))
        print(f"[LLMProxy] upstream responses exception: {error}", flush=True)
        return _response_json({"error": error}, status_code=502)


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
        from tradingagents.default_config import DEFAULT_CONFIG
    except ImportError:
        return AnalyzeResponse(
            status="error", query=req.query, error="tradingagents not installed"
        )
    except Exception:
        traceback.print_exc()
        return AnalyzeResponse(
            status="error", query=req.query, error=traceback.format_exc()
        )

    try:
        config = _build_tradingagents_config(req, DEFAULT_CONFIG)
        ticker = extract_ticker(req.query)
        date = req.date or _today_iso()
        asset_type = _infer_asset_type(req.query, ticker, req.asset_type)
        with _forwarded_provider_api_key(config.get("llm_provider"), req.llm_api_key):
            ta = TradingAgentsGraph(debug=False, config=config)

        finance_task = (
            asyncio.create_task(fetch_finance_context(ticker))
            if ticker and ticker != "MKT"
            else None
        )
        # High-volume social data fetching (300-500 sources target)
        reddit_task = asyncio.create_task(fetch_reddit_posts(req.query, max_posts=100))
        x_task = asyncio.create_task(fetch_x_posts(req.query, max_results=100))
        agent_reach_task = asyncio.create_task(fetch_agent_reach_research(req.query))
        propagate_task = asyncio.create_task(asyncio.to_thread(_propagate_graph, ta, ticker, date, asset_type))

        _, decision = await propagate_task

        reddit_posts: Any = []
        try:
            reddit_posts = await asyncio.wait_for(reddit_task, timeout=30.0)
        except Exception as e:
            print(f"[Reddit] Failed to fetch: {e}")
            reddit_posts = []

        x_posts: Any = []
        try:
            x_posts = await asyncio.wait_for(x_task, timeout=30.0)
        except Exception as e:
            print(f"[X/Twitter] Failed to fetch: {e}")
            x_posts = []

        agent_reach_result: Any = {"error": "Agent-Reach enrichment timed out"}
        try:
            agent_reach_result = await asyncio.wait_for(agent_reach_task, timeout=60.0)
        except Exception as e:
            print(f"[Agent-Reach] Failed: {e}")
            agent_reach_result = {"error": f"Agent-Reach failed: {e}"}

        finance_context = None
        if finance_task is not None:
            try:
                finance_context = await asyncio.wait_for(finance_task, timeout=0.1)
            except Exception:
                finance_context = None

        if isinstance(reddit_posts, Exception):
            reddit_posts = []
        if isinstance(x_posts, Exception):
            x_posts = []
        if isinstance(agent_reach_result, Exception):
            agent_reach_result = {"error": str(agent_reach_result)}

        social_context = _merge_social_context(reddit_posts, x_posts, agent_reach_result)
        raw_output = {
            "ticker": ticker,
            "asset_type": asset_type,
            "decision": str(decision),
            "agent_reach": agent_reach_result,
        }
        if finance_context is not None:
            raw_output["finance_context"] = finance_context
        if social_context is not None:
            raw_output["social_context"] = social_context

        sentiment_report = None
        if social_context is not None:
            sentiment_report = {"social_context": social_context}

        return AnalyzeResponse(
            status="completed",
            query=req.query,
            sentiment_report=sentiment_report,
            reddit_report={"posts": reddit_posts} if reddit_posts else None,
            x_report={"tweets": x_posts} if x_posts else None,
            decision=str(decision),
            raw_output=raw_output,
        )
    except Exception:
        tb = traceback.format_exc()
        traceback.print_exc()
        return AnalyzeResponse(status="error", query=req.query, error=tb)


@app.post("/analyze/native")
async def analyze_native(req: AnalyzeRequest):
    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
        from tradingagents.default_config import DEFAULT_CONFIG
    except ImportError:
        return {"status": "failed", "query": req.query, "error": "tradingagents not installed"}
    except Exception:
        traceback.print_exc()
        return {"status": "failed", "query": req.query, "error": traceback.format_exc()}

    try:
        started_at = time.time()
        _log_phase("request-start", query=req.query[:80], date=req.date, asset_type=req.asset_type)
        config = _build_tradingagents_config(req, DEFAULT_CONFIG)
        ticker = extract_ticker(req.query)
        trade_date = req.date or _today_iso()
        asset_type = _infer_asset_type(req.query, ticker, req.asset_type)
        native_timeout = req.native_timeout_seconds or int(os.getenv("TRADINGAGENTS_NATIVE_TIMEOUT_SECONDS", "360"))
        _log_phase(
            "config-ready",
            ticker=ticker,
            trade_date=trade_date,
            asset_type=asset_type,
            provider=config.get("llm_provider"),
            backend_url=config.get("backend_url"),
            deep_model=config.get("deep_think_llm"),
            quick_model=config.get("quick_think_llm"),
            max_recur_limit=config.get("max_recur_limit"),
            timeout_seconds=native_timeout,
        )

        if req.clear_checkpoints:
            try:
                from tradingagents.graph.checkpointer import clear_all_checkpoints

                clear_all_checkpoints(config["data_cache_dir"])
                _log_phase("checkpoints-cleared", data_cache_dir=config["data_cache_dir"])
            except Exception as e:
                print(f"[NativeGraph] clear checkpoints failed: {e}")

        selected_analysts = _selected_analysts(req)
        forwarded_api_key = (
            req.llm_api_key
            or os.getenv("TRADINGAGENTS_LLM_API_KEY")
            or os.getenv("LLM_API_KEY")
            or os.getenv("LITELLM_API_KEY")
        )
        with _forwarded_provider_api_key(config.get("llm_provider"), forwarded_api_key):
            _log_phase("graph-init-start", selected_analysts=selected_analysts)
            graph = TradingAgentsGraph(debug=False, config=config, selected_analysts=selected_analysts)
            _log_phase("graph-init-complete")

        _log_phase("propagate-start")
        final_state, decision = await asyncio.wait_for(
            asyncio.to_thread(_propagate_graph, graph, ticker, trade_date, asset_type),
            timeout=native_timeout,
        )
        _log_phase("propagate-complete", elapsed_seconds=round(time.time() - started_at, 2), decision=str(decision))
        final_state = _json_safe(final_state if isinstance(final_state, dict) else {})
        investment_debate = final_state.get("investment_debate_state", {}) if isinstance(final_state, dict) else {}
        risk_debate = final_state.get("risk_debate_state", {}) if isinstance(final_state, dict) else {}
        final_decision = final_state.get("final_trade_decision") or str(decision)
        confidence, probability = _rating_metrics(str(decision))

        return {
            "status": "completed",
            "query": req.query,
            "ticker": ticker,
            "asset_type": asset_type,
            "trade_date": trade_date,
            "signal": str(decision),
            "fundamentals": _as_report(final_state.get("fundamentals_report")),
            "sentiment": _as_report(final_state.get("sentiment_report")),
            "news": _as_report(final_state.get("news_report")),
            "technical": _as_report(final_state.get("market_report")),
            "bull_researcher": _as_report(investment_debate.get("bull_history") if isinstance(investment_debate, dict) else None),
            "bear_researcher": _as_report(investment_debate.get("bear_history") if isinstance(investment_debate, dict) else None),
            "trader": _as_report(final_state.get("trader_investment_plan") or final_state.get("investment_plan")),
            "risk_manager": _as_report(risk_debate.get("history") if isinstance(risk_debate, dict) else None),
            "portfolio_manager": _as_report(final_decision),
            "full_report": {
                "ticker": ticker,
                "asset_type": asset_type,
                "trade_date": trade_date,
                "signal": str(decision),
                "investment_plan": final_state.get("investment_plan"),
                "trader_investment_plan": final_state.get("trader_investment_plan"),
                "investment_debate_state": investment_debate,
                "risk_debate_state": risk_debate,
                "final_trade_decision": final_decision,
                "config": {
                    "llm_provider": config.get("llm_provider"),
                    "deep_think_llm": config.get("deep_think_llm"),
                    "quick_think_llm": config.get("quick_think_llm"),
                    "max_debate_rounds": config.get("max_debate_rounds"),
                    "max_risk_discuss_rounds": config.get("max_risk_discuss_rounds"),
                    "output_language": config.get("output_language"),
                    "checkpoint_enabled": config.get("checkpoint_enabled"),
                    "selected_analysts": selected_analysts,
                    "benchmark_ticker": config.get("benchmark_ticker"),
                    "benchmark_map": config.get("benchmark_map"),
                    "max_recur_limit": config.get("max_recur_limit"),
                    "memory_log_max_entries": config.get("memory_log_max_entries"),
                    "analyst_concurrency_limit": config.get("analyst_concurrency_limit"),
                    "news_article_limit": config.get("news_article_limit"),
                    "global_news_article_limit": config.get("global_news_article_limit"),
                    "global_news_lookback_days": config.get("global_news_lookback_days"),
                    "global_news_queries": config.get("global_news_queries"),
                    "openai_reasoning_effort": config.get("openai_reasoning_effort"),
                    "google_thinking_level": config.get("google_thinking_level"),
                    "anthropic_effort": config.get("anthropic_effort"),
                    "data_vendors": config.get("data_vendors"),
                    "tool_vendors": config.get("tool_vendors"),
                },
            },
            "confidence": confidence,
            "probability": probability,
            "error": None,
        }
    except asyncio.TimeoutError:
        timeout_seconds = req.native_timeout_seconds or int(os.getenv("TRADINGAGENTS_NATIVE_TIMEOUT_SECONDS", "360"))
        _log_phase("propagate-timeout", timeout_seconds=timeout_seconds)
        return {
            "status": "failed",
            "query": req.query,
            "error": f"TradingAgents native graph exceeded {timeout_seconds}s timeout",
        }
    except Exception:
        tb = traceback.format_exc()
        traceback.print_exc()
        _log_phase("request-failed", error=tb[-1000:])
        return {"status": "failed", "query": req.query, "error": tb}


@app.post("/analyze/reddit", response_model=AnalyzeResponse)
async def analyze_reddit(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    posts = await fetch_reddit_posts(req.query, max_posts=10)

    if not posts:
        return AnalyzeResponse(
            status="completed",
            query=req.query,
            reddit_report={"posts": [], "summary": "No Reddit posts found"},
        )

    posts_text = "\n".join(
        f"- r/{p['subreddit']} (score:{p['score']}, comments:{p['num_comments']}): {p['title']}"
        f"\n  {p['selftext'][:200]}"
        for p in posts[:8]
    )

    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a social sentiment analyst specializing in Reddit. Analyze the given Reddit posts for market-relevant insights. Respond ONLY with valid JSON.",
        user=f"Analyze these Reddit posts for: {req.query}\n\n{posts_text}\n\n"
        'Return JSON: {"overall_sentiment": "bullish/bearish/neutral", "confidence": 0.0-1.0, '
        '"key_themes": [...], "community_consensus": "...", "contrarian_signals": [...], '
        '"notable_posts": [{"title": "...", "insight": "..."}]}',
    )

    return AnalyzeResponse(
        status="completed" if result and "error" not in result else "error",
        query=req.query,
        reddit_report={"posts": posts, "analysis": result}
        if result and "error" not in result
        else {"posts": posts},
        error=str(result.get("error", "")) if result and "error" in result else None,
    )


@app.post("/analyze/x", response_model=AnalyzeResponse)
async def analyze_x(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    tweets = await fetch_x_posts(req.query, max_results=10)

    if not tweets:
        return AnalyzeResponse(
            status="completed",
            query=req.query,
            x_report={"tweets": [], "summary": "No X/Twitter posts found"},
        )

    tweets_text = "\n".join(
        f"- {t['title']}\n  {t['content'][:200]}" for t in tweets[:8]
    )

    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a social media analyst specializing in X/Twitter. Analyze tweets for market signals. Respond ONLY with valid JSON.",
        user=f"Analyze these X/Twitter posts for: {req.query}\n\n{tweets_text}\n\n"
        'Return JSON: {"overall_sentiment": "bullish/bearish/neutral", "confidence": 0.0-1.0, '
        '"key_narratives": [...], "viral_signals": [...], "influencer_opinions": [...]}',
    )

    return AnalyzeResponse(
        status="completed" if result and "error" not in result else "error",
        query=req.query,
        x_report={"tweets": tweets, "analysis": result}
        if result and "error" not in result
        else {"tweets": tweets},
        error=str(result.get("error", "")) if result and "error" in result else None,
    )


@app.post("/analyze/news", response_model=AnalyzeResponse)
async def analyze_news(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["deep_model"],
        system="You are a financial news analyst. Respond ONLY with valid JSON.",
        user=f"News for: {req.query}\nDate: {req.date or _today_iso()}\nJSON: headlines[], sentiment, key_themes[], confidence (0-1)",
    )
    if result and "error" not in result:
        return AnalyzeResponse(status="completed", query=req.query, news_report=result)
    return AnalyzeResponse(
        status="error",
        query=req.query,
        error=str(result.get("error", "LLM call failed")),
    )


@app.post("/analyze/sentiment", response_model=AnalyzeResponse)
async def analyze_sentiment(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a market sentiment analyst. Respond ONLY with JSON.",
        user=f"Sentiment for: {req.query}\nJSON: overall_sentiment, key_themes[], community_views[], confidence (0-1)",
    )
    if result and "error" not in result:
        return AnalyzeResponse(
            status="completed", query=req.query, sentiment_report=result
        )
    return AnalyzeResponse(
        status="error",
        query=req.query,
        error=str(result.get("error", "LLM call failed")),
    )


@app.post("/analyze/technical", response_model=AnalyzeResponse)
async def analyze_technical(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a technical analyst. Respond ONLY with JSON.",
        user=f"Technical analysis for: {req.query}\nJSON: trend, key_levels, signals[], confidence (0-1)",
    )
    if result and "error" not in result:
        return AnalyzeResponse(
            status="completed", query=req.query, technical_report=result
        )
    return AnalyzeResponse(
        status="error",
        query=req.query,
        error=str(result.get("error", "LLM call failed")),
    )


@app.post("/analyze/all", response_model=AnalyzeResponse)
async def analyze_all(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    date_str = req.date or _today_iso()

    news_task = llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["deep_model"],
        system="You are a financial news analyst. Respond ONLY with JSON.",
        user=f"News for: {req.query}\nDate: {date_str}\nJSON: headlines[], sentiment, key_themes[], confidence (0-1)",
    )
    sentiment_task = llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a market sentiment analyst. Respond ONLY with JSON.",
        user=f"Sentiment for: {req.query}\nJSON: overall_sentiment, key_themes[], community_views[], confidence (0-1)",
    )
    technical_task = llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a technical analyst. Respond ONLY with JSON.",
        user=f"Technical analysis for: {req.query}\nJSON: trend, key_levels, signals[], confidence (0-1)",
    )
    reddit_task = fetch_reddit_posts(req.query, max_posts=100)
    x_task = fetch_x_posts(req.query, max_results=100)

    results = await asyncio.gather(
        news_task,
        sentiment_task,
        technical_task,
        reddit_task,
        x_task,
        return_exceptions=True,
    )

    news = results[0] if isinstance(results[0], dict) else {"error": str(results[0])}
    sentiment = (
        results[1] if isinstance(results[1], dict) else {"error": str(results[1])}
    )
    technical = (
        results[2] if isinstance(results[2], dict) else {"error": str(results[2])}
    )
    reddit_posts = results[3] if isinstance(results[3], list) else []
    x_posts = results[4] if isinstance(results[4], list) else []

    reddit_analysis = None
    if reddit_posts:
        posts_text = "\n".join(
            f"- r/{p['subreddit']} ({p['score']}pts): {p['title']}"
            for p in reddit_posts[:8]
        )
        reddit_analysis = await llm_chat(
            cfg["base_url"],
            cfg["headers"],
            cfg["quick_model"],
            system="You are a social sentiment analyst. Analyze Reddit posts for market insights. Respond ONLY with valid JSON.",
            user=f"Reddit posts for: {req.query}\n\n{posts_text}\n\n"
            'Return JSON: {"overall_sentiment": "bullish/bearish/neutral", "confidence": 0.0-1.0, '
            '"key_themes": [...], "contrarian_signals": [...]}',
        )

    x_analysis = None
    if x_posts:
        tweets_text = "\n".join(
            f"- {t['title']}: {t.get('content', '')[:200]}" for t in x_posts[:8]
        )
        x_analysis = await llm_chat(
            cfg["base_url"],
            cfg["headers"],
            cfg["quick_model"],
            system="You are a social media analyst. Analyze X/Twitter posts for market signals. Respond ONLY with valid JSON.",
            user=f"X/Twitter posts for: {req.query}\n\n{tweets_text}\n\n"
            'Return JSON: {"overall_sentiment": "bullish/bearish/neutral", "confidence": 0.0-1.0, '
            '"key_narratives": [...], "viral_signals": [...]}',
        )

    if isinstance(sentiment, dict) and "error" in sentiment and (reddit_posts or x_posts):
        sentiment = {
            "overall_sentiment": "unknown",
            "confidence": 0.35,
            "key_themes": [
                post.get("title", "") for post in reddit_posts[:5] if isinstance(post, dict)
            ],
            "community_views": [
                "Sentiment LLM analysis failed, but relevant social evidence was collected.",
                f"Reddit posts: {len(reddit_posts)}",
                f"X/Twitter posts: {len(x_posts)}",
            ],
            "source": "social-evidence-fallback",
        }

    if isinstance(news, dict) and "error" in news:
        news = {
            "headlines": [],
            "sentiment": "unknown",
            "key_themes": ["News LLM analysis failed; use collected social and search evidence for synthesis."],
            "confidence": 0.2,
            "source": "degraded-fallback",
            "warning": "Primary news analyst returned no usable content.",
        }

    if isinstance(technical, dict) and "error" in technical:
        technical = {
            "trend": "unknown",
            "key_levels": [],
            "signals": ["Technical LLM analysis failed; no deterministic price series was available to compute indicators."],
            "confidence": 0.2,
            "source": "degraded-fallback",
            "warning": "Primary technical analyst returned no usable content.",
        }

    errors = []
    for name, data in [
        ("news", news),
        ("sentiment", sentiment),
        ("technical", technical),
    ]:
        if isinstance(data, dict) and "error" in data:
            errors.append(f"{name}: {data['error']}")

    return AnalyzeResponse(
        status="completed",
        query=req.query,
        news_report=news if "error" not in news else None,
        sentiment_report=sentiment if "error" not in sentiment else None,
        technical_report=technical if "error" not in technical else None,
        reddit_report={"posts": reddit_posts, "analysis": reddit_analysis}
        if reddit_analysis
        else ({"posts": reddit_posts} if reddit_posts else None),
        x_report={"tweets": x_posts, "analysis": x_analysis}
        if x_analysis
        else ({"tweets": x_posts} if x_posts else None),
        error="; ".join(errors) or None,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("TA_PORT", "8100"))
    uvicorn.run(app, host="0.0.0.0", port=port)
