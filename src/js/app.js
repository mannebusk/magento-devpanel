/**
 * App enrty point
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React      from 'react';
import ReactDOM   from 'react-dom';
import Panel      from 'components/Panel.jsx';

document.addEventListener("DOMContentLoaded", ()=> {
  ReactDOM.render(<Panel/>, document.querySelector("#dev-panel-root"));
});
