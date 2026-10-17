import { GraphQLError } from "graphql";
import type { Actor } from "./models.js";

type ResolveActor = () => Promise<Actor | null>;

export function createRequestActor(resolveActor: ResolveActor): ResolveActor {
  let actorPromise: Promise<Actor | null> | undefined;

  return function getActor(): Promise<Actor | null> {
    actorPromise ??= Promise.resolve()
      .then(resolveActor)
      .catch(() => {
        throw new GraphQLError("Authentication temporarily unavailable", {
          extensions: { code: "SERVICE_UNAVAILABLE" },
        });
      });

    return actorPromise;
  };
}
