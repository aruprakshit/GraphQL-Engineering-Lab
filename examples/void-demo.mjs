import { setTimeout as delay } from "node:timers/promises";

async function work(label) {
  console.log(`${label}: started`);
  await delay(100);
  console.log(`${label}: finished`);
}

work("Without void");
void work("With void");

console.log("Both calls started. This line did not wait for either one.");
