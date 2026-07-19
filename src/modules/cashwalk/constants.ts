// 캐시워크 공용 상수(어댑터·모듈 간 순환 의존 방지용 분리).
export const STEP_PER_MILESTONE = 1000; // 마일스톤 단위(보)
export const DAILY_STEP_CAP = 20000; // 하루 보상 인정 상한
export const REWARD_PER_MILESTONE = 20; // 마일스톤당 보상(원)
export const MAX_MILESTONES_PER_DAY = Math.floor(DAILY_STEP_CAP / STEP_PER_MILESTONE);
