import { db } from '@/lib/db';
import { callLLMJson } from '@/lib/engine/llm-client';

export interface CausalTreeDecomposition {
  root: CausalTreeNodeInput;
}

export interface CausalTreeNodeInput {
  label: string;
  importanceWeight: number;
  children?: CausalTreeNodeInput[];
}

export interface CausalTreeAggregation {
  finalProbability: number;
  confidence: number;
  leafCount: number;
  leafContributions: Array<{ label: string; probability: number; weight: number; contribution: number }>;
}

export class CausalTreeEngine {
  /**
   * Decompose a market thesis into an assumption tree via LLM prompt.
   * Stores root + children as CausalTreeNode rows in DB.
   * Returns the root node (with DB id).
   */
  async decomposeThesis(
    marketTitle: string,
    researchRunId: string,
    model?: string,
  ): Promise<{ rootId: string; tree: CausalTreeDecomposition }> {
    const prompt = `Decompose this prediction market thesis into a causal tree:
"${marketTitle}"

Break it down into:
1. Main factors affecting the outcome
2. Sub-factors for each main factor
3. Assign importance weights (0-1) per node. Sibling weights should sum to 1.0.
4. Keep tree depth to 3 levels max.

Return as JSON with:
{ "root": { "label": "...", "importanceWeight": 1.0, "children": [{ "label": "...", "importanceWeight": 0.5, "children": [...] }] } }`;

    const systemPrompt = `You are an expert causal reasoning analyst. You break down prediction market theses into structured causal trees.
Each node is a factor that influences the outcome. Weights represent relative importance among siblings and must sum to 1.0.
Respond ONLY with valid JSON. No markdown, no explanation.`;

    let tree: CausalTreeDecomposition;
    try {
      const result = await callLLMJson<CausalTreeDecomposition>(prompt, systemPrompt, model);
      tree = result.data;
    } catch (error) {
      console.warn('[CausalTree] LLM call failed, using fallback decomposition:', error);
      tree = this._buildFallbackTree(marketTitle);
    }

    const rootId = await this._persistTree(researchRunId, tree.root, null);

    return { rootId, tree };
  }

  /**
   * Research a single node by attaching evidence.
   * Updates the node's evidence, probability, confidence, and sourceQuality in DB.
   */
  async researchNode(
    nodeId: string,
    evidence: string,
    probability?: number,
    confidence?: number,
    sourceQuality?: number,
  ): Promise<void> {
    await db.causalTreeNode.update({
      where: { id: nodeId },
      data: {
        evidence,
        probability: probability ?? null,
        confidence: confidence ?? null,
        sourceQuality: sourceQuality ?? null,
        lastUpdated: new Date(),
      },
    });
  }

  /**
   * Aggregate tree: weighted average of leaf node probabilities.
   * Traverses the tree, collecting only leaf nodes, computing a weighted
   * average scaled by importance weights inherited from the path.
   */
  async aggregateTree(rootNodeId: string): Promise<CausalTreeAggregation> {
    const root = await db.causalTreeNode.findUnique({
      where: { id: rootNodeId },
      include: { children: true },
    });

    if (!root) {
      return { finalProbability: 0.5, confidence: 0, leafCount: 0, leafContributions: [] };
    }

    const { leaves } = await this._collectLeaves(root.id);

    if (leaves.length === 0) {
      return {
        finalProbability: root.probability ?? 0.5,
        confidence: root.confidence ?? 0.3,
        leafCount: 0,
        leafContributions: [],
      };
    }

    let totalWeight = 0;
    let weightedSum = 0;
    let confidenceSum = 0;
    const contributions: Array<{ label: string; probability: number; weight: number; contribution: number }> = [];

    for (const leaf of leaves) {
      const prob = leaf.probability ?? 0.5;
      const weight = leaf.effectiveWeight;
      const contrib = prob * weight;
      weightedSum += contrib;
      totalWeight += weight;
      confidenceSum += (leaf.confidence ?? 0.3) * weight;

      contributions.push({
        label: leaf.label,
        probability: prob,
        weight,
        contribution: contrib,
      });
    }

    const finalProbability = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
    const confidence = totalWeight > 0 ? confidenceSum / totalWeight : 0.3;

    await db.causalTreeNode.update({
      where: { id: root.id },
      data: {
        probability: finalProbability,
        confidence,
        lastUpdated: new Date(),
      },
    });

    return { finalProbability, confidence, leafCount: leaves.length, leafContributions: contributions };
  }

  /**
   * Track node accuracy post-resolution.
   * Records whether the node's predicted probability matched the actual outcome.
   */
  async trackNodeAccuracy(nodeId: string, outcome: string): Promise<void> {
    const node = await db.causalTreeNode.findUnique({ where: { id: nodeId } });
    if (!node) return;

    const wasCorrect =
      outcome === 'YES'
        ? (node.probability ?? 0.5) > 0.5
        : (node.probability ?? 0.5) <= 0.5;

    const resolutionNote = `Resolved: ${outcome}. Predicted: ${(node.probability ?? 0.5).toFixed(2)}. Correct: ${wasCorrect}`;
    const existing = node.contradictions || '';

    await db.causalTreeNode.update({
      where: { id: nodeId },
      data: {
        contradictions: existing ? `${existing}\n${resolutionNote}` : resolutionNote,
        lastUpdated: new Date(),
      },
    });
  }

  private async _persistTree(
    researchRunId: string,
    node: CausalTreeNodeInput,
    parentId: string | null,
  ): Promise<string> {
    const created = await db.causalTreeNode.create({
      data: {
        researchRunId,
        parentId,
        label: node.label,
        importanceWeight: node.importanceWeight,
        probability: null,
        confidence: null,
        sourceQuality: null,
        evidence: null,
        contradictions: null,
      },
    });

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        await this._persistTree(researchRunId, child, created.id);
      }
    }

    return created.id;
  }

  private async _collectLeaves(
    nodeId: string,
    inheritedWeight = 1.0,
  ): Promise<{ leaves: Array<{ label: string; probability: number | null; confidence: number | null; effectiveWeight: number }> }> {
    const node = await db.causalTreeNode.findUnique({
      where: { id: nodeId },
      include: { children: true },
    });

    if (!node) return { leaves: [] };

    const effectiveWeight = inheritedWeight * node.importanceWeight;

    if (node.children.length === 0) {
      return {
        leaves: [{
          label: node.label,
          probability: node.probability,
          confidence: node.confidence,
          effectiveWeight,
        }],
      };
    }

    const leaves: Array<{ label: string; probability: number | null; confidence: number | null; effectiveWeight: number }> = [];
    for (const child of node.children) {
      const result = await this._collectLeaves(child.id, effectiveWeight);
      leaves.push(...result.leaves);
    }

    return { leaves };
  }

  private _buildFallbackTree(marketTitle: string): CausalTreeDecomposition {
    const lowerTitle = marketTitle.toLowerCase();
    const factors: CausalTreeNodeInput[] = [];

    const keywordMap: Record<string, string> = {
      election: 'Electoral dynamics & polling',
      price: 'Market pricing & supply-demand',
      gdp: 'Economic growth indicators',
      inflation: 'Inflation trends & monetary policy',
      war: 'Geopolitical conflict dynamics',
      crypto: 'Crypto market sentiment & adoption',
      regulation: 'Regulatory & legal environment',
      weather: 'Weather & climate patterns',
      disease: 'Public health & epidemiological data',
      sports: 'Team/player performance & injuries',
      ai: 'AI technology & adoption trends',
      earnings: 'Corporate earnings & financials',
      rate: 'Interest rate & central bank policy',
      oil: 'Energy commodity dynamics',
      tech: 'Technology sector performance',
    };

    for (const [keyword, label] of Object.entries(keywordMap)) {
      if (lowerTitle.includes(keyword)) {
        factors.push({ label, importanceWeight: 0, children: [] });
      }
    }

    if (factors.length === 0) {
      factors.push(
        { label: 'Primary outcome driver', importanceWeight: 0, children: [] },
        { label: 'Secondary influencing factor', importanceWeight: 0, children: [] },
        { label: 'External risk factor', importanceWeight: 0, children: [] },
      );
    }

    const evidenceFactors: CausalTreeNodeInput[] = [
      { label: 'Recent data & trends', importanceWeight: 0, children: [] },
      { label: 'Expert consensus & forecasts', importanceWeight: 0, children: [] },
      { label: 'Contradictory signals', importanceWeight: 0, children: [] },
    ];

    const totalFactors = factors.length;
    factors.forEach((f) => {
      f.importanceWeight = 1 / totalFactors;
      f.children = evidenceFactors.map((ef) => ({
        ...ef,
        importanceWeight: 1 / evidenceFactors.length,
      }));
    });

    return {
      root: {
        label: marketTitle,
        importanceWeight: 1.0,
        children: factors,
      },
    };
  }
}

export const causalTreeEngine = new CausalTreeEngine();
