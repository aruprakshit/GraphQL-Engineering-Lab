import { depthLimit } from "@graphile/depth-limit";
import type { ValidationRule } from "graphql";

/**
 * Depth means how far down a query goes on its longest path.
 * Count fields that open another set of selected fields:
 *
 * query {
 *   posts {          // level 1
 *     edges {        // level 2
 *       node {       // level 3
 *         author {   // level 4
 *           name     // scalar value: does not add another level
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * This query has depth 4, so our limit of 4 accepts it.
 * More sibling fields, such as title beside author, do not add levels.
 */
export const MAX_QUERY_DEPTH = 4;

export function createDepthValidationRule(): ValidationRule {
  return depthLimit({
    // Allow at most 4 object-selection levels on any application path.
    maxDepth: MAX_QUERY_DEPTH,

    // Count LISTS separately from ordinary objects.
    // In our real query above, only edges returns a list: list depth = 1.
    //
    // Imagine a friends field returning a list of users:
    // user { friends { friends { name } } }
    //        list 1    list 2                  -> allowed by this limit
    //
    // user { friends { friends { friends { name } } } }
    //        list 1    list 2    list 3         -> rejected by this limit
    //
    // friends is an example from our test schema, not an application field.
    maxListDepth: 2,

    // Count repeated use of the SAME schema field on one nested path.
    // Example from the test schema:
    // node { child { child { name } } }
    //        Node.child appears twice on this path.
    //
    // This setting allows up to 4 repeats. The overall depth limit still
    // applies and can reject the path sooner. We chose 4 so this extra
    // rule does not stop our depth-boundary examples before maxDepth does.
    maxSelfReferentialDepth: 4,

    // A fragment is a reusable group of selected fields, not another level.
    // node { ...Fields }
    // fragment Fields on Node { child { name } }
    // counts like node { child { name } }: depth 2, not 3.
    fragmentsAddToDepth: false,

    // Include the reason in rejection messages, such as depth 5 > limit 4.
    // This makes failures easier to understand in this learning project.
    revealDetails: true,

    // We leave the package's separate introspection limits at their defaults.
    // Introspection is how the playground asks what fields/types exist.
    // Those schema-discovery queries need deeper nesting than our app queries.
  });
}
