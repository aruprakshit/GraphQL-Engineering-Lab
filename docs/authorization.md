# Authorization design

- Anonymous visitors can read published posts.
- Signed-in users can create drafts.
- Authors can read their drafts and edit or publish their posts.
- Admins can read drafts and edit or publish any author's posts.
- Author status is determined by comparing actor.userId with post.authorId.
- Authentication supplies identity; GraphQL inputs cannot choose the actor.
- Post services enforce object authorization and business rules.
- Publication requires the post to currently be a draft.
- Lists filter out inaccessible records before applying pagination.
- Existing seed posts will be marked published.
- Test scenarios must cover both allowed and denied access.

## Permissions

| Action | Anonymous | Signed-in non-author | Post author | Admin |
|---|---|---|---|---|
| Read published posts | Allowed | Allowed | Allowed | Allowed |
| Read a draft | Denied | Denied | Allowed | Allowed |
| Create a draft | Denied | Allowed | Allowed | Allowed |
| Edit a post | Denied | Denied | Allowed | Allowed |
| Publish a draft | Denied | Denied | Allowed | Allowed |

“Post author” means the signed-in user whose ID matches the post's
authorId. It is a relationship to that post, not a global role.

Publishing also requires the post to currently be a draft.
