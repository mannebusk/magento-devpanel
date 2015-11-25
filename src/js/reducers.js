/**
 * Application Actions
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import { routeConst, panelConst } from "actions.js";
import { combineReducers }        from "redux";

export function route(state = "", action) {

  if (action.type == routeConst.GOTO) {
    state = action.route;
  }

  return state;
}

export function panel(state, action) {
  if (!state) {
    state = {
      open: false,
      loading: false,
      sneakPeak: false
    };
  }

  switch (action.type) {
    case panelConst.OPEN:
    case panelConst.CLOSE:
      return Object.assign({}, state, {
        open: action.open
      });
      break;

    case panelConst.SHOW_SNEAKPEAK:
    case panelConst.HIDE_SNEAKPEAK:
      return Object.assign({}, state, {
        sneakPeak: action.sneakPeak
      });
      break;

    default:
      break;
  }

  return state;
}

export default combineReducers({
  route: route,
  panel: panel
});

