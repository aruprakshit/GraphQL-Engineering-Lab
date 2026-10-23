import { createApp } from "./app.js";
import { readConfig } from "./config.js";

readConfig();

const app = createApp();
const port = 4001;

app.listen(port, "0.0.0.0", () => {
  console.log(`User service listening on port ${port}`);
});
