import { resolveHello } from "./hello.js";
import { resolveLearningCheck } from "./learning-check.js";
import { resolvePosts } from "./posts.js";
import { resolveLogin } from "./login.js";
import { resolveMe } from "./me.js";
import { resolveLogout } from "./logout.js";
import { resolveCreateDraft } from "./create-draft.js";

export const rootValue = {
  hello: resolveHello,
  learningCheck: resolveLearningCheck,
  posts: resolvePosts,
  login: resolveLogin,
  me: resolveMe,
  logout: resolveLogout,
  createDraft: resolveCreateDraft,
};
