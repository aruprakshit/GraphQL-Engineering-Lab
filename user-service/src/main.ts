import express from "express";

const app = express();
const port = 4001;

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "graphql-user-service",
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`User service listening on port ${port}`);
});
