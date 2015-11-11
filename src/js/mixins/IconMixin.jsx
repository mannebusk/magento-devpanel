/**
 * Icon Mixin
 *
 */
import React from 'react';

export default {
  /**
   * Get an icon and return it as an React component
   *
   * @param {String} name
   *
   * @return ReactElement
   */
  getIcon: function(svg) {

    return (
      <span
        className="icon"
        dangerouslySetInnerHTML={{__html: svg}}
      >
      </span>
    );
  }
}
