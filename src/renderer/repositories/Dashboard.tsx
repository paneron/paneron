/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';

import { css, jsx } from '@emotion/core';

import React, { useEffect, useState } from 'react';

import {
  Button as BPButton,
  MenuItem, Menu,
  IButtonProps, InputGroup,
  IPanelProps, PanelStack,
  Icon, Tree, ITreeNode,
  FormGroup, ControlGroup,
  Colors, Classes
} from '@blueprintjs/core';

import { NonIdealState, Spinner } from '@blueprintjs/core';

import {
  listRepositories,
  getStructuredRepositoryInfo, getRepositoryStatus, repositoryStatusChanged,
  savePassword, repositoriesChanged,
  deleteRepository, getRepositoryInfo, repositoryDetails
} from 'repositories';

import {
  Repository,
  RepoStatus,
} from 'repositories/types';

import { WindowComponentProps } from 'window';

import PluginStatusButton from 'renderer/plugins/PluginStatusButton';

import StartNewRepoForm from './StartNewRepoForm';
import ShareRepoForm from './ShareRepoForm';
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

  function handleNodeClick(node: ITreeNode, _: unknown, evt: React.MouseEvent) {
    if (node.id !== 'new') {
      selectRepo(`${node.id}`);
    } else {
      handleAdd();
    }
  }

  async function handleNodeDoubleClick(node: ITreeNode, _: unknown, evt: React.MouseEvent) {
    if (node.id !== 'new') {
      await repositoryDetails.renderer!.open({
        componentParams: `workingCopyPath=${node.id}`,
        title: `${node.id}`,
      });
    }
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
      <section css={css`flex: 1;min-height: 132px; display: flex; flex-flow: column nowrap; overflow-y: auto;`}>
        <Tree
          css={{ flex: 1 }}
          contents={[ ...repoNodes, {
            disabled: true,
            id: 'new',
            label: '',
            secondaryLabel: <Button minimal small onClick={handleAdd} icon="add">Add repository</Button> } ]}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick} />
      </section>

      <section
          className={Classes.ELEVATION_1}
          css={css`flex: 0; height: 370px; display: flex; background: ${Colors.LIGHT_GRAY5};`}>
        {selectedRepo
          ? <PanelStack key={selectedRepo} css={css`flex: 1; background: ${Colors.LIGHT_GRAY5};`} initialPanel={{
              component: RepoDetails,
              title: "Repository details",
              props: {
                workingCopyPath: selectedRepo,
              },
            }} />
          : null}
      </section>
    </div>
  );
};


const RepoDetails: React.FC<IPanelProps & { workingCopyPath: string }> = function ({ openPanel, workingCopyPath }) {
  const repoInfo = getRepositoryInfo.renderer!.useValue({ workingCopyPath }, {
    info: { workingCopyPath },
  });
  const structuredRepoInfo = getStructuredRepositoryInfo.renderer!.useValue({ workingCopyPath }, {
    info: null,
  });
  const pluginID = structuredRepoInfo.value.info?.pluginID;

  const author = repoInfo.value.info.author;
  const remote = repoInfo.value.info.remote;

  function handleShare() {
    openPanel({
      component: ShareRepoPanel,
      title: "Share repository",
      props: {
        repo: repoInfo.value.info,
      },
    });
  }

  return (
    <div css={css`flex: 1; padding: 1rem; overflow-y: auto; background: ${Colors.LIGHT_GRAY5};`}>
      <FormGroup label="Working copy:">
        <ControlGroup>
          <InputGroup fill readOnly value={workingCopyPath} />
          <Button disabled>Locate</Button>
        </ControlGroup>
      </FormGroup>

      <FormGroup label="Structured data repository type:">
        <ControlGroup>
          <InputGroup fill disabled value={pluginID} />
          {pluginID
            ? <PluginStatusButton id={pluginID} />
            : structuredRepoInfo.isUpdating
              ? <Button loading />
              : <Button intent="warning" disabled icon="error">Unknown repository type</Button>}
        </ControlGroup>
      </FormGroup>

      <FormGroup label="Authoring as:">
        <ControlGroup>
          <InputGroup
            fill disabled
            value={author ? `${author.name} <${author.email}>` : '(missing authorship information)'} />
        </ControlGroup>
      </FormGroup>

      <FormGroup label="Sharing:">
        {remote
          ? <ControlGroup>
              <InputGroup
                fill disabled
                value={remote ? remote.url : '(repository is not shared)'} />
              <Button disabled>Open in browser</Button>
            </ControlGroup>
          : <Button fill onClick={handleShare}>Share</Button>}
      </FormGroup>

      <ControlGroup vertical>
        <Button onClick={() => deleteRepository.renderer!.trigger({ workingCopyPath })}>
          Delete working copy
        </Button>
      </ControlGroup>
    </div>
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


const ShareRepoPanel: React.FC<IPanelProps & { repo: Repository }> =
function ({ closePanel, repo }) {
  return (
    <div css={css`flex: 1; padding: 1rem; background: ${Colors.LIGHT_GRAY5}; overflow-y: auto; `}>
      <ShareRepoForm
        workingCopyPath={repo.workingCopyPath}
        onComplete={() => { setImmediate(closePanel); }}
      />
    </div>
  );
};


const PasswordInput: React.FC<{ workingCopyPath: string, remoteURL: string, username: string }> =
function ({ workingCopyPath, remoteURL, username }) {
  const [value, setValue] = useState<string>('');
  const [isBusy, setBusy] = useState(false);

  async function handlePasswordConfirm() {
    setBusy(true);
    try {
      await savePassword.renderer!.trigger({ workingCopyPath, remoteURL, username, password: value });
    } catch (e) {
      setBusy(false);
    }
  }

  return (
    <InputGroup
      type="password"
      value={value}
      small
      placeholder="Password required"
      disabled={isBusy}
      onChange={(event: React.FormEvent<HTMLElement>) =>
        setValue((event.target as HTMLInputElement).value)}
      rightElement={
        value.trim() === ''
        ? undefined
        : <Button
              minimal={true}
              disabled={isBusy}
              small
              onClick={handlePasswordConfirm}
              icon="tick"
              intent="primary">
            Confirm
          </Button>}
    />
  );
};


const formatStatusOrOperation = (txt: string) => txt.replace(/[-]/g, ' ').replace(/^\w/, (txt) => txt.toUpperCase());


const OP_LABELS = {
  'pulling': 'syncing',
  'pushing': 'syncing',
  'cloning': 'adding',
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
          buttonProps.icon = 'offline';
          buttonText = "Network error";
        } else if (status.busy.awaitingPassword) {
          buttonProps.icon = 'key';
          buttonText = null;
          if (repo.remote?.url) {
            extraWidget = <PasswordInput
              workingCopyPath={repo.workingCopyPath}
              remoteURL={repo.remote.url}
              username={repo.remote.username} />;
          } else {
            extraWidget = <Icon icon="error" />;
          }
        } else {
          buttonText = formatStatusOrOperation(OP_LABELS[status.busy.operation]);
          buttonProps.icon = status.busy.operation === 'pushing' ? 'cloud-upload' : 'cloud-download';
          const progress = status.busy.progress;
          const progressValue = progress ? (1 / progress.total * progress.loaded) : undefined;
          const phase = progress?.phase;
          const formattedPhase = (phase && phase.toLowerCase() !== 'analyzing workdir')
            ? formatStatusOrOperation(phase)
            : null;
          extraWidget = <Button small disabled
              icon={<Spinner
                size={Icon.SIZE_STANDARD}
                value={(progressValue !== undefined && !isNaN(progressValue)) ? progressValue : undefined} />}>
            {formattedPhase}
          </Button>;
        }
        break;

      default:
        buttonText = formatStatusOrOperation(status.busy.operation);
        buttonProps.icon = <Spinner size={Icon.SIZE_STANDARD} />;
        break;
    }
  } else {
    buttonText = formatStatusOrOperation(status.status);

    if (status.status === 'invalid-working-copy') {
      buttonProps.icon = 'error';
    } else {
      if (repo.remote) {
        buttonProps.icon = 'tick-circle';
      } else {
        buttonProps.icon = 'offline';
      }
    }
  }

  return <ControlGroup css={css`& > * { text-transform: lowercase }`}>
    <Button small disabled {...buttonProps}>{buttonText}</Button>
    {extraWidget}
  </ControlGroup>
};


const Button = (props: React.PropsWithChildren<IButtonProps>) => (
  <BPButton css={css`white-space: nowrap;`} {...props} />
);


export default Window;
