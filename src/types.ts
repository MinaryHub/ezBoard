// 회로/PCB 데이터 모델. 단위는 모두 mm.

export type Layer = 'top' | 'bottom';

export interface Part {
  ref: string;        // R1, LED1, U1 ...
  type: string;       // 부품 라이브러리 키 (resistor, led, ne555 ...)
  value: string;      // 330Ω, 10uF, 빨강 ...
  x: number;          // 보드 위 중심 좌표
  y: number;
  rot: number;        // 0 | 90 | 180 | 270
  note?: string;      // AI가 남긴 설명
}

export interface Net {
  name: string;       // GND, VCC, NET1 ...
  pins: string[];     // "R1.1", "U1.VCC" ...
}

export interface Track {
  net: string;
  layer: Layer;
  width: number;
  points: [number, number][];
}

export interface Via {
  net: string;
  x: number;
  y: number;
}

export interface Board {
  width: number;
  height: number;
}

/** 회로도에서 부품 기호의 위치 (그리드 단위) */
export interface SchPos {
  x: number;
  y: number;
  rot: number;
}

export interface Project {
  name: string;
  board: Board;
  parts: Part[];
  nets: Net[];
  tracks: Track[];
  vias: Via[];
  sch?: Record<string, SchPos>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  circuitApplied?: boolean;
  error?: boolean;
}

export type Provider = 'claude' | 'gemini' | 'openai';

export interface AiSettings {
  provider: Provider;
  keys: Record<Provider, string>;
  models: Record<Provider, string>;
  /** 연결 방식: API 키 / 로그인한 계정(데스크톱 앱에서 공식 CLI 사용) */
  auth: Record<Provider, AuthMode>;
  /** 계정 연결 때 쓸 모델 (비우면 CLI 기본값) */
  cliModels: Record<Provider, string>;
}

export type AuthMode = 'key' | 'account';
