export default {
  globalData: {
    apiBaseUrl: "https://launch-wonder-construction-unto.trycloudflare.com/mindiou-api",
    apiToken: "",
    sessionDuration: 60,
    reportId: "3419476b-5c6a-4fc8-883c-010f2ef68bfd",
    cardId: "14d58888-c176-42ed-bca9-643490a3f888"
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
