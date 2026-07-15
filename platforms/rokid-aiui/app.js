export default {
  globalData: {
    apiBaseUrl: "http://192.168.5.119:8793",
    apiToken: "",
    sessionDuration: 60
  },

  onLaunch(options = {}) {
    const query = options.query || {};
    if (query.api) this.globalData.apiBaseUrl = decodeURIComponent(query.api);
    if (query.token) this.globalData.apiToken = decodeURIComponent(query.token);
    console.log("Learn Coach for Rokid launched");
  }
};
