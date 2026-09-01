import { createSlice } from '@reduxjs/toolkit';
import { defaultVisibility } from '../utils/indicators/visibility.js';

/**
 * Which indicator groups are currently shown: { sma20: true, macd: false, ... }
 *
 * The slice IS the visibility map — deliberately FLAT, with no wrapping
 * `visibility` key. That is not a style choice, it is what makes persistence
 * correct: redux-persist's autoMergeLevel2 merges the keys one level inside
 * each slice. Flat, those keys are the group ids, so a group added in a later
 * release is absent from stored state and keeps its default of visible.
 * Nested under `visibility`, level 2 would replace that whole object and the
 * new group would come back undefined — hidden, with no way for the user to
 * tell why.
 *
 * Redux Toolkit's reducers look like they mutate, but they run inside Immer,
 * which records the writes and returns a new immutable object. That is what
 * lets useSelector detect the change by reference.
 */
const indicatorVisibilitySlice = createSlice({
  name: 'indicatorVisibility',

  // Everything on: a first-time visitor should see what exists.
  initialState: defaultVisibility(),

  reducers: {
    /** @param action.payload {string} the group id, e.g. 'bollinger' */
    visibilityToggled(state, action) {
      const groupId = action.payload;
      state[groupId] = !state[groupId];
    },
  },
});

export const { visibilityToggled } = indicatorVisibilitySlice.actions;

/**
 * Returns the same object reference until a toggle actually changes it, so
 * subscribing components re-render only when visibility really moved.
 */
export const selectVisibility = (state) => state.indicatorVisibility;

export default indicatorVisibilitySlice.reducer;
