import { readFileSync, existsSync } from "node:fs";

const pluginUrl = process.env.G2_LEARNING_PLUGIN_URL || "http://localhost:5175";
const apiUrl = process.env.G2_LEARNING_API_URL || "http://localhost:8793";
const tokenPath = process.env.G2_LEARNING_TOKEN_FILE || "/tmp/g2-learning.token";
const token = process.env.LEARNING_API_TOKEN || (existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : "");

const url = new URL(pluginUrl);
url.searchParams.set("api", apiUrl);
if (token) url.searchParams.set("token", token);

console.log(url.toString());
