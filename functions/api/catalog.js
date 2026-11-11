// GET /api/catalog -> { skus }  Public list of SKUs that have their own price configured.
// Never returns price IDs.
import { json, sellables } from '../_lib.js';

export const onRequestGet = ({ env }) => json({ skus: Object.keys(sellables(env || {})) });
