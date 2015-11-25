/**
 * Application Actions
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
export const routeConst = {
  GOTO: "ROUTE_GOTO"
}

export const panelConst = {
  OPEN: "PANEL_OPEN",
  CLOSE: "PANEL_CLOSE",
  SHOW_SNEAKPEAK: "PANEL_SHOW_SNEAKPEAK",
  HIDE_SNEAKPEAK: "PANEL_HIDE_SNEAKPEAK"
}

export function goToRoue(route) {
  return {
    type: GOTO_ROUTE,
    route: route
  }
};

export function openPanel() {
  return {
    type: panelConst.OPEN,
    open: true
  };
}

export function closePanel() {
  return {
    type: panelConst.CLOSE,
    open: false
  };
}

export function showPanelSneakPeak() {
  return {
    type: panelConst.SHOW_SNEAKPEAK,
    sneakPeak: true
  };
}

export function hidePanelSneakPeak() {
  return {
    type: panelConst.HIDE_SNEAKPEAK,
    sneakPeak: false
  };
}
