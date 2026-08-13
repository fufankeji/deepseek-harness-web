import assert from "node:assert/strict";
import { increment } from "./src/counter.js";

assert.equal(increment(2), 3, "increment should add one");
console.log("counter acceptance passed");
