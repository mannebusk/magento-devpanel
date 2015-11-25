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
  HIDE_SNEAKPEAK: "PANEL_HIDE_SNEAKPEAK",
  SHOW_MENU: "PANEL_MENU_SHOW",
  HIDE_MENU: "PANEL_MENU_HIDE"
}

export function goToRoute(route) {
  return {
    type: routeConst.GOTO,
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

export function openMenu() {
  return {
    type: panelConst.SHOW_MENU,
    showMenu: true
  };
}

export function closeMenu() {
  return {
    type: panelConst.HIDE_MENU,
    showMenu: false
  };
}
