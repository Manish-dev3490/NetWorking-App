import { createContext } from 'react';

// The app owns active edit sessions so refreshing a feed cannot discard them.
export const PostEditorContext = createContext(null);
