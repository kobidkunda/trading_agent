let _testMode: boolean = true;

export function isTestMode(): boolean {
  return _testMode;
}

export function setTestMode(mode: boolean): void {
  _testMode = mode;
}

export function getModeLabel(): string {
  return _testMode ? 'TEST' : 'LIVE';
}