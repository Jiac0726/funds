// Keep empty for local and real-device debugging before the custom backend domain is ICP-ready.
// When the backend domain is ready, set this to something like "https://api.example.com/funds-api".
const API_BASE_URL = "";
const CLOUD_ENV_ID = "bgdb-1g0pwgmg56054bef";
const CLOUD_STATE_COLLECTION = "fund_user_states";
const CLOUD_FUNCTION_API = "fundsApi";

module.exports = {
  API_BASE_URL,
  CLOUD_ENV_ID,
  CLOUD_STATE_COLLECTION,
  CLOUD_FUNCTION_API
};
