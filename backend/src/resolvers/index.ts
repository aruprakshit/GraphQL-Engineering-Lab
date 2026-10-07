import { resolveHello } from "./hello.js";
import { resolveLearningCheck } from "./learning-check.js";
import { resolvePosts } from "./posts.js";

export const rootValue = {
  hello: resolveHello,
  learningCheck: resolveLearningCheck,
  posts: resolvePosts,
};
