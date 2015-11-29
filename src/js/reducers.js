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
      open: true,
      loading: false,
      showLoader: false,
      sneakPeak: false,
      showMenu: false,
      title: "DevPanel"
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

    case panelConst.SHOW_MENU:
    case panelConst.HIDE_MENU:
      return Object.assign({}, state, {
        showMenu: action.showMenu
      });
      break;

    case panelConst.START_LOADING:
      return Object.assign({}, state, {
        loading: action.loading,
        showLoader: action.showLoader
      });
      break;

    case panelConst.STOP_LOADING:
      return Object.assign({}, state, {
        loading: action.loading,
      });
      break;

    case panelConst.HIDE_LOADER:
      return Object.assign({}, state, {
        showLoader: action.showLoader,
      });
      break;

    case panelConst.SET_TITLE:
      return Object.assign({}, state, {
        title: action.title,
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

