/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { jsx } from '@emotion/react';
import React from 'react';
import ErrorState from '@riboseinc/paneron-extension-kit/widgets/ErrorState';



class ErrorBoundary extends React.Component<{ viewName?: string; }, { error?: string; }> {
  constructor(props: { viewName: string; }) {
    super(props);
    this.state = { error: undefined };
  }
  componentDidCatch(error: Error, info: any) {
    log.error("Error rendering view", this.props.viewName, error, info);
    this.setState({ error: `${error.name}: ${error.message}` });
  }
  render() {
    if (this.state.error !== undefined) {
      return <ErrorState viewName={this.props.viewName} technicalDetails={this.state.error} />;
    }
    return this.props.children;
  }
}


export default ErrorBoundary;
