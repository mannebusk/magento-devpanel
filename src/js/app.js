/**
 * App enrty point
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React                      from 'react';
import { render }                 from 'react-dom';
import { Provider, subscribe }    from 'react-redux'
import { createStore }            from "redux";
import devPanel                   from "./reducers";
import Panel                      from 'components/Panel.jsx';
import DevApp                     from 'components/DevApp.jsx'

let store;
let localState = localStorage.getItem('DevPanel');

// Initialize store with state from local storage if exists
if (localState) {
  store = createStore(devPanel, JSON.parse(localState));
} else {
  store = createStore(devPanel);
}

// Save state to local storage when updated
store.subscribe(()=> {
  localStorage.setItem("DevPanel", JSON.stringify(store.getState()));
});

// Render application when DOM is ready
document.addEventListener("DOMContentLoaded", ()=> {
  render(
    <Provider store={store}>
      <Panel>
        <DevApp/>
      </Panel>
    </Provider>,
    document.querySelector("#dev-panel-root")
  );
});
