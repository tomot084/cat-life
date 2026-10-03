// Idle-frame body bounds exclude tail-weighted vertices. Units match the exported GLBs.
// Keep these values synchronized with config/production-models.json.
export const catProportions = {
  "purin": {
    "bodyHeight": 7.525072395801544,
    "displayBodyHeight": 1.25
  },
  "kokoro": {
    "bodyHeight": 8.409239038825035,
    "displayBodyHeight": 1.52
  }
} as const;
