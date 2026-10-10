// DOCUMENT STORED IN THE USERS COLLECTION
export interface UserDocument {
  _id: string;
  name: string;
}

// DOCUMENT STORED IN THE POSTS COLLECTION
export interface PostDocument {
  _id: string;
  title: string;
  authorId: string;
  status: "draft" | "published";
}
