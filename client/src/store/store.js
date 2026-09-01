import { combineReducers, configureStore } from '@reduxjs/toolkit';
import {
  FLUSH,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  REHYDRATE,
  persistReducer,
  persistStore,
} from 'redux-persist';
import autoMergeLevel2Module from 'redux-persist/lib/stateReconciler/autoMergeLevel2.js';
import storageModule from 'redux-persist/lib/storage/index.js';
import { PERSISTED_SLICES, PERSIST_KEY, PERSIST_VERSION } from '../constants/storage.js';
import indicatorVisibilityReducer from './indicatorVisibilitySlice.js';

/**
 * redux-persist ships Babel-compiled CommonJS. A bundler unwraps `default` for
 * us; Node's ESM interop hands back the module namespace instead. Unwrapping
 * explicitly makes this file behave identically under Vite and under plain
 * `node`, which is what lets the store be tested without a browser.
 */
const storage = storageModule.default ?? storageModule;
const autoMergeLevel2 = autoMergeLevel2Module.default ?? autoMergeLevel2Module;

/**
 * One store for client-side UI state.
 *
 * Note what is NOT in here: candles and indicator values. Those are server
 * state — owned by the backend, delivered over REST and a WebSocket, and
 * written straight to the chart's canvas without passing through React. Putting
 * a 200-point series in Redux would mean an action, a reducer pass and a
 * re-render every minute to produce numbers the canvas already has.
 *
 * Redux holds what the USER decides. The server owns the rest. That split is
 * also why persisting the whole store is safe here — there is nothing in it
 * that would go stale.
 */
const rootReducer = combineReducers({
  indicatorVisibility: indicatorVisibilityReducer,
});

const persistConfig = {
  key: PERSIST_KEY,
  version: PERSIST_VERSION,
  storage,
  whitelist: PERSISTED_SLICES,

  /**
   * TWO levels of merging, not the default one.
   *
   * autoMergeLevel1 replaces each slice wholesale with whatever was stored, so
   * a toggle group added in a later release would be missing from the
   * rehydrated state — undefined, therefore hidden, with no way for the user to
   * tell why. Level 2 merges the keys INSIDE each slice over the reducer's
   * initial state, so unknown-to-storage groups keep their default of visible.
   *
   * This only works because the visibility slice is FLAT: its keys are the
   * group ids themselves. Nesting them under a `visibility` object would put
   * them at depth 3, out of reach of level-2 merging.
   */
  stateReconciler: autoMergeLevel2,
};

export const store = configureStore({
  reducer: persistReducer(persistConfig, rootReducer),

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // redux-persist dispatches these with non-serializable payloads (the
        // rehydrate callback). They are internal, so exempt them rather than
        // switching the whole check off — it still guards our own actions.
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);
