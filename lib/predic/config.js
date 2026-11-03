
export const MODEL_VERSION = "1.0.0";

export const LEAGUE_PRESETS = {
  default: { avgHomeGoals: 1.52, avgAwayGoals: 1.18, homeAdvantage: 1.0 },
  epl: { avgHomeGoals: 1.55, avgAwayGoals: 1.22, homeAdvantage: 1.0 },
  laliga: { avgHomeGoals: 1.48, avgAwayGoals: 1.12, homeAdvantage: 1.0 },
  seriea: { avgHomeGoals: 1.42, avgAwayGoals: 1.12, homeAdvantage: 1.0 },
  bundesliga: { avgHomeGoals: 1.62, avgAwayGoals: 1.32, homeAdvantage: 0.95 },
  ligue1: { avgHomeGoals: 1.42, avgAwayGoals: 1.12, homeAdvantage: 1.0 },
  eredivisie: { avgHomeGoals: 1.65, avgAwayGoals: 1.28, homeAdvantage: 0.95 },
  champions: { avgHomeGoals: 1.45, avgAwayGoals: 1.15, homeAdvantage: 0.9 },
  international: { avgHomeGoals: 1.35, avgAwayGoals: 1.10, homeAdvantage: 0.85 },
  neutral: { avgHomeGoals: 1.35, avgAwayGoals: 1.25, homeAdvantage: 0.55 },
};

export const WEIGHTS = {
  
  season: 0.45,
  recentForm: 0.35,
  homeAwaySplit: 0.20,
  xgVsGoals: 0.58, 
  
  shrinkMatches: 6,
  formHalfLife: 4.5,
  h2hWeight: 0.08,
  
  maxTotalAdjustment: 0.38,
  
  rho: -0.075,
  maxGoals: 10,
  
  priorHome: 0.44,
  priorDraw: 0.26,
  priorAway: 0.30,
  priorWeight: 0.18,
  marketWeight: 0.5,
  
  minQualityForHighConfidence: 0.75,
  minQualityForMediumConfidence: 0.5,
  factorScale: 0.18,
  maxFactorLog: 0.32,
  factorWeights: {
    form: 0.30,
    availability: 0.34,
    fatigue: 0.30,
    travel: 0.10,
    morale: 0.18,
    cohesion: 0.12,
    manager: 0.08,
    motivation: 0.16,
    h2h: 0.07,
    crowd: 0.08,
    weather: 0.12,
    pitch: 0.07,
    referee: 0.05,
    altitude: 0.08,
    style: 0.10,
    goalkeeper: 0.12,
    setPiece: 0.07,
    discipline: 0.05,
    rotation: 0.10,
    kickoff: 0.06,
    derby: 0.05,
    extra: 0.15,
  },
};

export const DEFAULTS = {
  league: {
    name: "Unknown League",
    preset: "default",
    avgHomeGoals: 1.52,
    avgAwayGoals: 1.18,
    avgGoals: 2.7,
    homeAdvantage: 1.0,
  },
  match: {
    date: null,
    venue: "home", 
    competition: "league",
    importance: 5, 
    isDerby: false,
    kickoff: null,
    altitudeM: 0,
  },
  context: {
    weather: { condition: "normal", tempC: 20, windKph: 10, rainMm: 0 },
    pitch: { quality: 8, widthM: 68, lengthM: 105 },
    referee: { strictness: 5, penaltyRate: 0.25, homeBias: 0 },
    crowd: { attendance: null, capacity: null, awaySupport: null },
  },
  team: {
    name: "Unknown",
    season: {
      played: 0, wins: 0, draws: 0, losses: 0,
      goalsFor: 0, goalsAgainst: 0, points: 0, position: null,
      xgFor: null, xgAgainst: null, cleanSheets: null,
    },
    splits: {},
    lastMatches: [],
    players: [],
    condition: {
      morale: 6, fatigue: 4, sharpness: 7, cohesion: 7,
      managerChangeDays: null, lineupContinuity: 0.75,
      pressure: 5, confidence: 6,
    },
    schedule: {
      daysSinceLastMatch: 5, matchesLast14Days: 2, matchesLast7Days: 1,
      restHours: null,
      travelKm: 0, extraTimeLastMatch: false, nextMatchDays: 4,
      nextMatchImportance: 5,
    },
    style: {
      possession: 50, pressIntensity: 5, setPieceStrength: 5,
      counterAttack: 5, discipline: 5, directness: 5,
    },
    goalkeeper: { quality: 6.8, savePct: null },
    motivation: { stakes: 5, mustWin: false, titleRace: false, relegationBattle: false },
    h2h: [],
    extraFactors: [],
  },
};

export const POSITION_ATTACK_WEIGHT = {
  GK: 0.02, DF: 0.12, MF: 0.45, FW: 0.95,
};
export const POSITION_DEFENSE_WEIGHT = {
  GK: 0.5, DF: 0.8, MF: 0.3, FW: 0.03,
};

export const STATUS_AVAILABILITY = {
  available: 1,
  fit: 1,
  doubtful: 0.45,
  "less-fit": 0.6,
  "match-fit": 1,
  injured: 0,
  suspension: 0,
  suspended: 0,
  "out-for-season": 0,
  returning: 0.55,
  "international-duty": 0,
  unknown: 0.8,
};