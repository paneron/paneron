/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';

import { css, jsx } from '@emotion/core';

import React, { useEffect, useState } from 'react';

import {
  Button as BPButton, ButtonGroup,
  MenuItem, Menu,
  IButtonProps, InputGroup,
  IPanelProps, PanelStack,
  Icon, Tree, ITreeNode,
  FormGroup, ControlGroup,
  Colors, Classes,
} from '@blueprintjs/core';

import { NonIdealState, Spinner } from '@blueprintjs/core';

import {
  listRepositories,
  getStructuredRepositoryInfo, getRepositoryStatus, repositoryStatusChanged,
  savePassword, repositoriesChanged,
  deleteRepository, getRepositoryInfo, repositoryDetails
} from 'repositories';

import { getPluginInfo, installPlugin, pluginsUpdated } from 'plugins';

import {
  Repository,
  RepoStatus,
} from 'repositories/types';

import { WindowComponentProps } from 'window';
import StartNewRepoForm from './StartNewRepoForm';
import AddSharedRepoForm from './AddSharedRepoForm';


const Window: React.FC<WindowComponentProps> = function () {
  return (
    <PanelStack css={{ flex: 1 }} initialPanel={{
      component: RepoListPanel,
      title: "Repositories",
    }} />
  );
};


const RepoListPanel: React.FC<IPanelProps> = function ({ openPanel }) {
  const [selectedRepo, selectRepo] = useState<string | null>(null);
  const repos = listRepositories.renderer!.useValue({}, { objects: [] });

  repositoriesChanged.renderer!.useEvent(async () => {
    repos.refresh();
  }, []);

  useEffect(() => {
    if (repos.value.objects.find(r => r.workingCopyPath === selectedRepo) === undefined) {
      selectRepo(null);
    }
  }, [repos.value.objects.length, selectedRepo]);

  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && !repos.isUpdating) {
      setInitialized(true);

      if (repos.value.objects.length < 1) {
        openPanel({
          component: AddRepoPanel,
          title: "Add repository",
          props: {
            isInitial: true,
          },
        });
      }
    }
  }, [initialized, repos.isUpdating]);

  function handleAdd() {
    openPanel({
      component: AddRepoPanel,
      title: "Add repository",
    });
  }

  function handleNodeClick(node: ITreeNode) {
    selectRepo(`${node.id}`);
  }

  async function handleNodeDoubleClick(node: ITreeNode) {
    await repositoryDetails.renderer!.open({
      componentParams: `workingCopyPath=${node.id}`,
      title: `${node.id}`,
    });
  }

  const repoNodes: ITreeNode[] = repos.value.objects.map(repo => {
    return {
      id: repo.workingCopyPath,
      isSelected: repo.workingCopyPath === selectedRepo,
      label: path.basename(repo.workingCopyPath),
      icon: "git-repo",
      secondaryLabel: <RepoStatus repo={repo} />,
    };
  });

  return (
    <div css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden`}>
      <section css={css`flex: 1; display: flex; flex-flow: column nowrap`}>
        <Tree
          css={{ flex: 1 }}
          contents={repoNodes}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick} />
        <ButtonGroup fill>
          <Button css={{ margin: '1rem' }} onClick={handleAdd} icon="add">Add repository</Button>
        </ButtonGroup>
      </section>

      <section
          className={Classes.ELEVATION_1}
          css={css`padding: 1rem; background: ${Colors.LIGHT_GRAY5}; overflow-y: auto`}>
        {selectedRepo
          ? <RepoDetails key={selectedRepo} workingCopyPath={selectedRepo} />
          : null}
      </section>
    </div>
  );
};


const RepoDetails: React.FC<{ workingCopyPath: string }> = function ({ workingCopyPath }) {
  const repoInfo = getRepositoryInfo.renderer!.useValue({ workingCopyPath }, { info: {
    workingCopyPath,
  }});
  const structuredRepoInfo = getStructuredRepositoryInfo.renderer!.useValue({ workingCopyPath }, { info: null });
  const pluginID = structuredRepoInfo.value.info?.pluginID;

  const author = repoInfo.value.info.author;
  const remote = repoInfo.value.info.remote;

  return (
    <>
      <FormGroup label="Structured data repository type:">
        <ControlGroup>
          <InputGroup fill disabled value={pluginID} />
          {pluginID
            ? <PluginStatusButton id={pluginID} />
            : <Button intent="warning" disabled icon="error">Not a valid structured data repository</Button>}
        </ControlGroup>
      </FormGroup>

      <FormGroup label="Working copy:">
        <ControlGroup>
          <InputGroup fill readOnly value={workingCopyPath} />
          <Button disabled>Locate</Button>
        </ControlGroup>
      </FormGroup>

      <FormGroup label="Contributing as:">
        <ControlGroup>
          <InputGroup
            fill disabled
            value={author ? `${author.name} <${author.email}>` : '(missing authorship information)'} />
        </ControlGroup>
      </FormGroup>

      <FormGroup label="Upstream repository URL:">
        <ControlGroup>
          <InputGroup
            fill disabled
            value={remote ? remote.url : '(repository is not shared)'} />
          {remote ? null : <Button disabled>Share</Button>}
        </ControlGroup>
      </FormGroup>

      <ControlGroup vertical>
        <Button onClick={() => deleteRepository.renderer!.trigger({ workingCopyPath })}>
          Delete working copy
        </Button>
      </ControlGroup>
    </>
  );
};


const PluginStatusButton: React.FC<{ id: string }> = function ({ id }) {
  const pluginInfo = getPluginInfo.renderer!.useValue({ id }, { id, title: id });
  const installedVersion = pluginInfo.value.installedVersion;
  const [isBusy, setBusy] = useState(false);

  async function handleInstall() {
    if (installedVersion) { return; }

    setBusy(true);
    try {
      await installPlugin.renderer!.trigger({ id });
    } finally {
      setBusy(false);
    }
  }

  pluginsUpdated.renderer!.useEvent(async ({ changedIDs }) => {
    if (changedIDs === undefined || changedIDs.indexOf(id) >= 0) {
      pluginInfo.refresh();
    }
  }, []);

  if (pluginInfo.errors.length > 0) {
    const fetchError = pluginInfo.findError('FetchError');
    if (fetchError && fetchError.message.indexOf('registry.npmjs.org') >= 0) {
      return <Button icon="offline" disabled>Cannot connect to plugin registry</Button>;
    } else {
      return <Button icon="error" disabled>Cannot find plugin</Button>;
    }
  }

  return (
    <Button
        disabled={isBusy || installedVersion !== undefined}
        loading={isBusy}
        intent="success"
        onClick={handleInstall}
        icon={installedVersion ? 'tick-circle' : 'download'}>
      {installedVersion ? `Installed ${installedVersion}` : 'Install'}
    </Button>
  );
};


const AddRepoPanel: React.FC<IPanelProps & { isInitial?: true }> =
function ({ openPanel, closePanel, isInitial }) {
  function handleStartNew() {
    openPanel({
      component: StartNewRepoPanel,
      title: "Start new repository",
      props: {
        onComplete: closePanel,
      },
    });
  }

  function handleAddShared() {
    openPanel({
      component: AddSharedRepoPanel,
      title: "Add shared repository",
      props: {
        onComplete: closePanel,
      },
    });
  }

  return (
    <NonIdealState
      title={isInitial ? "Let’s start" : undefined}
      description={
        <Menu>
          <MenuItem onClick={handleAddShared} text="Add shared repository" icon="globe-network" />
          <MenuItem onClick={handleStartNew} text="Start new repository" icon="document" />
          <MenuItem disabled text="Add local working copy" icon="folder-open" />
        </Menu>
      }
    />
  );
};


const AddSharedRepoPanel: React.FC<IPanelProps & { onComplete: () => void }> =
function ({ closePanel, onComplete }) {
  return (
    <div css={{ textAlign: 'left', padding: '1rem', overflowY: 'auto' }}>
      <AddSharedRepoForm onCreate={() => { setImmediate(closePanel); setImmediate(onComplete); }} />
    </div>
  );
};


const StartNewRepoPanel: React.FC<IPanelProps & { onComplete: () => void }> =
function ({ closePanel, onComplete }) {
  return (
    <div css={{ textAlign: 'left', padding: '1rem', overflowY: 'auto' }}>
      <StartNewRepoForm onCreate={() => { setImmediate(closePanel); setImmediate(onComplete); }} />
    </div>
  );
};


const PasswordInput: React.FC<{ forRemote: string, username: string }> =
function ({ forRemote, username }) {
  const [value, setValue] = useState<string>('');

  async function handlePasswordConfirm() {
    await savePassword.renderer!.trigger({ remoteURL: forRemote, username, password: value });
  }

  return (
    <InputGroup
      type="password"
      value={value}
      small
      placeholder="Password required"
      onChange={(event: React.FormEvent<HTMLElement>) =>
        setValue((event.target as HTMLInputElement).value)}
      rightElement={
        value.trim() === ''
        ? undefined
        : <Button
              minimal={true}
              small
              onClick={handlePasswordConfirm}
              icon="tick"
              intent="primary">
            Confirm
          </Button>}
    />
  );
};


const RepoStatus: React.FC<{ repo: Repository }> = function ({ repo }) {
  const repoStatus = getRepositoryStatus.renderer!.useValue(
    { workingCopyPath: repo.workingCopyPath },
    { busy: { operation: 'initializing' } });

  const [latestStatus, setLatestStatus] = useState<RepoStatus | null>(null);

  repositoryStatusChanged.renderer!.useEvent(async ({ workingCopyPath, status }) => {
    if (workingCopyPath !== repo.workingCopyPath) {
      return;
    }
    setLatestStatus(status);
  }, []);

  const status = latestStatus || repoStatus.value;

  let buttonProps: IButtonProps = {};
  let buttonText: string | null;
  let extraWidget: JSX.Element | null = null;

  if (status.busy) {
    switch (status.busy.operation) {
      case 'pulling':
      case 'pushing':
      case 'cloning':
        if (status.busy.networkError) {
          buttonProps.icon = 'error';
          buttonText = "Network error";
        } else if (status.busy.awaitingPassword) {
          buttonProps.icon = 'key';
          buttonText = null;
          if (repo.remote?.url) {
            extraWidget = <PasswordInput forRemote={repo.remote.url} username={repo.remote.username} />;
          } else {
            extraWidget = <Icon icon="error" />;
          }
        } else {
          const progress = status.busy.progress;
          const progressValue = progress ? (1 / progress.total * progress.loaded) : undefined;
          buttonText = progress?.phase || status.busy.operation;
          buttonProps.icon = <Spinner
            size={Icon.SIZE_STANDARD}
            value={(progressValue !== undefined && !isNaN(progressValue)) ? progressValue : undefined} />;
        }
        break;

      default:
        buttonText = status.busy.operation;
        buttonProps.icon = <Spinner size={Icon.SIZE_STANDARD} />;
        break;
    }
  } else {
    buttonText = status.status;

    if (repo.remote) {
      buttonProps.icon = 'tick-circle';
    } else {
      buttonProps.icon = 'offline';
    }
  }

  return <ControlGroup>
    <Button small disabled {...buttonProps}>{buttonText}</Button>
    {extraWidget}
  </ControlGroup>
};


const Button = (props: React.PropsWithChildren<IButtonProps>) => (
  <BPButton css={css`white-space: nowrap;`} {...props} />
);


export default Window;
