import { resolveHello } from "./hello.js";
import { resolveLearningCheck } from "./learning-check.js";
import { resolvePosts } from "./posts.js";
import { resolveLogin } from "./login.js";
import { resolveMe } from "./me.js";
import { resolveLogout } from "./logout.js";
import { resolveCreateDraft } from "./create-draft.js";
import { resolveUpdatePost } from "./update-post.js";
import { resolvePublishPost } from "./publish-post.js";
import { resolveFindPost } from "./find-post.js";

export const rootValue = {
  hello: resolveHello,
  learningCheck: resolveLearningCheck,
  posts: resolvePosts,
  login: resolveLogin,
  me: resolveMe,
  logout: resolveLogout,
  createDraft: resolveCreateDraft,
  updatePost: resolveUpdatePost,
  publishPost: resolvePublishPost,
  post: resolveFindPost,
};
