import { Router } from 'express';

export const apiRoutes = Router();

// Mount feature routers here as their vertical slices are implemented:
// apiRoutes.use('/auth', authRoutes);
// Internal modules communicate through services, not HTTP calls.
