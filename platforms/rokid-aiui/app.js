export default {
  globalData: {
    apiBaseUrl: "https://114.67.169.78/mindiou-api",
    apiToken: "",
    sessionDuration: 60,
    reportId: "c18ecc67-6725-4b60-bc0a-a73e53150d5e",
    cardId: "card-2"
  },

  onLaunch(options = {}) {
    const query = options.query || {};
    if (query.api) this.globalData.apiBaseUrl = decodeURIComponent(query.api);
    if (query.token) this.globalData.apiToken = decodeURIComponent(query.token);
    if (query.reportId) this.globalData.reportId = decodeURIComponent(query.reportId);
    if (query.cardId) this.globalData.cardId = decodeURIComponent(query.cardId);
    console.log("Learn Coach for Rokid launched");
  }
};
