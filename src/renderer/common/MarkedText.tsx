/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
import React, { useEffect, useRef } from 'react';
import Mark from 'mark.js';


const MarkedText: React.FC<{ text: string; term?: string; }> = function ({ text, term }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current && term) {
      const mark = new Mark(ref.current);
      mark.mark(term, {
        accuracy: 'partially',
        separateWordSearch: false,
        caseSensitive: false,
      });
      return function cleanup() {
        mark.unmark();
      };
    }
    return () => void 0;
  }, [text, term]);

  return (
    <span ref={ref}>{text}</span>
  );
};


export default MarkedText;
