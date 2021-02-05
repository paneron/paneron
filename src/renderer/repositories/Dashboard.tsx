/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';

import { remote } from 'electron';

import { css, jsx } from '@emotion/core';
import styled from '@emotion/styled';
import React, { useEffect, useState } from 'react';

import {
  MenuItem, Menu,
  InputGroup,
  IPanelProps, PanelStack,
  Tree, ITreeNode,
  FormGroup, ControlGroup,
  NonIdealState,
  Colors, Classes, IPanelStackProps,
  H4, Card, Tooltip, H3, UL, Callout,
} from '@blueprintjs/core';

import { WindowComponentProps } from 'window';

import {
  listRepositories,
  repositoriesChanged,
  deleteRepository,
  listPaneronRepositories,
  setPaneronRepositoryInfo,
  getBufferDataset,
} from 'repositories';
import { PaneronRepository, Repository } from 'repositories/types';
import RepoStatus from './RepoStatus';
import StartNewRepoForm from './StartNewRepoForm';
import ShareRepoForm from './ShareRepoForm';
import AddSharedRepoForm from './AddSharedRepoForm';

import {
  getPluginInfo,
  listAvailablePlugins,
  pluginsUpdated,
} from 'plugins';
import { Extension } from 'plugins/types';
import DatasetExtension, { DatasetExtensionCardProps } from 'renderer/plugins/DatasetExtensionCard';

import {
  datasetDetails,
  deleteDataset,
  getDatasetInfo,
  initializeDataset,
  proposeDatasetPath,
} from 'datasets';

import { forceSlug } from 'utils';
import { AuthorDetails, Button } from '../widgets';
import { deserializeMeta } from 'main/meta-serdes';


const Window: React.FC<WindowComponentProps> = function () {
  return (
    <PanelStack css={{ flex: 1 }} initialPanel={{
      component: RepoListPanel,
      title: "Repositories",
    }} renderActivePanelOnly={false} />
  );
};


const RepoListPanel: React.FC<IPanelProps> = function ({ openPanel }) {
  // Tracking selected tree node is done by storing its node data here.
  const [selectedItem, selectItem] = useState<NodeData>({ type: 'newrepository' });

  const repos = listRepositories.renderer!.useValue({}, { objects: [] });
  const paneronRepos = listPaneronRepositories.renderer!.useValue(
    { workingCopyPaths: repos.value.objects.map(v => v.workingCopyPath) },
    { objects: {} });

  repositoriesChanged.renderer!.useEvent(async () => {
    await repos.refresh();
    await paneronRepos.refresh();
  }, []);

  // Ensure item selection is reset if selected item is no longer available.
  //useEffect(() => {
  //  const selectedItemWorkingPath = selectedItem?.workingCopyPath || null;
  //  if (selectedItemWorkingPath && repos.value.objects.find(r => r.workingCopyPath === selectedItemWorkingPath) === undefined) {
  //    selectItem(null);
  //  }
  //}, [repos.value.objects.length, JSON.stringify(selectedItem)]);

  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && !repos.isUpdating && !paneronRepos.isUpdating) {
      setInitialized(true);

      const selectedItemWorkingPath = selectedItem.workingCopyPath || null;
      const shouldSelectNewRepo = repos.value.objects.length < 1 || (
        selectedItemWorkingPath &&
        repos.value.objects.find(r => r.workingCopyPath === selectedItemWorkingPath) === undefined);

      if (shouldSelectNewRepo) {
        selectItem({ type: 'newrepository' });
      }
    }
  }, [initialized, repos.isUpdating, paneronRepos.isUpdating, selectedItem.workingCopyPath]);

  const isBusy = repos.isUpdating || paneronRepos.isUpdating || !initialized;

  const selectedRepo: Repository | null = selectedItem.workingCopyPath
    ? repos.value.objects.find(repo => repo.workingCopyPath === selectedItem.workingCopyPath!) || null
    : null;

  const selectedRepoPaneronMeta: PaneronRepository | null = selectedRepo
    ? paneronRepos.value.objects[selectedRepo.workingCopyPath] || null
    : null;

  function handleStartNewRepo() {
    openPanel({
      component: StartNewRepo,
      title: "Start new repository",
    });
  }
  function handleAddSharedRepo() {
    openPanel({
      component: AddSharedRepo,
      title: "Add shared repository",
      props: {
        onAdd: (workingCopyPath) => selectItem({ type: 'repository', workingCopyPath }),
      }
    });
  }
  function handleEditRepository(repo: Repository, paneronRepo: PaneronRepository) {
    openPanel({
      component: EditRepository,
      title: "Edit repository",
      props: {
        repo,
        paneronRepo,
      },
    });
  }
  function handleInitializeDataset(repo: Repository, paneronRepo: PaneronRepository, extension: Extension) {
    openPanel({
      component: InitializeDataset,
      title: "Initialize new dataset",
      props: {
        repo,
        paneronRepo,
        extension,
        onComplete: (datasetPath) => selectItem({
          type: 'dataset',
          workingCopyPath: repo.workingCopyPath,
          datasetPath,
        }),
      },
    });
  }

  async function handleOpenDataset(workingCopyPath: string, datasetPath?: string) {
    await datasetDetails.renderer!.open({
      componentParams: `workingCopyPath=${workingCopyPath}&datasetPath=${datasetPath}`,
      title: `${datasetPath} in repository ${selectedRepoPaneronMeta?.title || workingCopyPath}`,
    });
  }

  function handleNodeClick(node: ITreeNode<NodeData>, _: unknown, evt: React.MouseEvent) {
    if (node.nodeData) {
      selectItem(node.nodeData);
    }
  }

  async function handleNodeDoubleClick(node: ITreeNode<NodeData>, _: unknown, evt: React.MouseEvent) {
    if (node.nodeData?.datasetPath && node.nodeData.workingCopyPath) {
      await handleOpenDataset(node.nodeData.workingCopyPath, node.nodeData.datasetPath)
    }
  }

  const repoNodes:
  ITreeNode<NodeData>[] =
  repos.value.objects.map(repo => {
    const paneronRepo = (
      paneronRepos.value.objects[repo.workingCopyPath] ||
      (paneronRepos.isUpdating ? undefined : null));

    const isReadOnly =
      repo.remote !== undefined &&
      repo.remote?.writeAccess !== true;

    const datasetPaths: string[] = !paneronRepo
      ? []
      : paneronRepo.dataset !== undefined
        ? ['.'] // Representing dataset path as a dot if it’s occupying the entire repo
        : Object.keys(paneronRepo.datasets);

    const datasetNodes:
    ITreeNode<DatasetNodeData | NewDatasetNodeData>[] =
    datasetPaths.length > 0
      ? datasetPaths.map(datasetPath => {
          return {
            id: `${repo.workingCopyPath}-${datasetPath}`,
            icon: "database",
            isSelected:
              selectedItem.type === 'dataset' &&
              selectedItem.workingCopyPath === repo.workingCopyPath &&
              selectedItem.datasetPath === datasetPath,
            label: <DatasetLabel workingCopyPath={repo.workingCopyPath} datasetPath={datasetPath} />,
            nodeData: { type: 'dataset', workingCopyPath: repo.workingCopyPath, datasetPath },
          };
        })
      : [];

    if (!isReadOnly && paneronRepo) {
      datasetNodes.push({
        id: `${repo.workingCopyPath}-newdataset`,
        isSelected:
          selectedItem.type === 'newdataset' &&
          selectedItem.workingCopyPath === repo.workingCopyPath,
        icon: "add",
        label: "Dataset…",
        nodeData: { type: 'newdataset', workingCopyPath: repo.workingCopyPath },
      });
    }

    return {
      id: repo.workingCopyPath,
      icon: paneronRepo === null
        ? "warning-sign"
        : paneronRepo === undefined
          ? "blank"
          : "git-repo",
      isSelected:
        selectedItem.type === 'repository' &&
        repo.workingCopyPath === selectedItem.workingCopyPath,
      isExpanded: true,
      hasCaret: datasetPaths.length > 0,
      label: paneronRepo?.title || path.basename(repo.workingCopyPath),
      secondaryLabel: <ControlGroup css={css`& > * { text-transform: lowercase }`}>
        <RepoStatus repo={repo} />
        {isReadOnly
          ? <Button small disabled icon="lock">read-only</Button>
          : null}
      </ControlGroup>,
      nodeData: { type: 'repository', workingCopyPath: repo.workingCopyPath },
      childNodes: datasetNodes,
    };
  });

  if (!isBusy) {
    repoNodes.push({
      id: 'newrepository',
      isSelected: selectedItem.type === 'newrepository',
      icon: 'add',
      label: "Repository…",
      nodeData: { type: 'newrepository' },
    });
  }

  let detailsPanel: IPanelStackProps["initialPanel"];
  if (selectedItem.type === 'repository' && selectedRepo) {
    detailsPanel = {
      component: RepoDetails,
      title: "Repository details",
      props: {
        repo: selectedRepo,
        paneronRepo: selectedRepoPaneronMeta || undefined,
        onEdit: selectedRepoPaneronMeta && (!selectedRepo.remote || selectedRepo.remote.writeAccess)
          ? () => handleEditRepository(selectedRepo, selectedRepoPaneronMeta)
          : undefined,
      },
    };
  } else if (selectedItem.type === 'dataset' && selectedRepoPaneronMeta?.datasets?.[selectedItem.datasetPath!]) {
    detailsPanel = {
      component: DatasetDetails,
      title: "Dataset details",
      props: {
        workingCopyPath: selectedItem.workingCopyPath,
        datasetPath: selectedItem.datasetPath,
        onOpen: selectedItem.workingCopyPath && selectedItem.datasetPath
          ? () => selectedItem.workingCopyPath && selectedItem.datasetPath
            ? handleOpenDataset(selectedItem.workingCopyPath, selectedItem.datasetPath)
            : void 0
           : undefined,
      },
    };
  } else if (selectedItem.type === 'newdataset' && selectedItem.workingCopyPath && selectedRepo && selectedRepoPaneronMeta) {
    detailsPanel = {
      component: DatasetExtensionBrowser,
      title: "Initialize new dataset",
      props: {
        onSelect: selectedRepo && selectedRepoPaneronMeta
          ? (ext: Extension) => selectedRepo && selectedRepoPaneronMeta
              ? handleInitializeDataset(selectedRepo, selectedRepoPaneronMeta, ext)
              : void 0
          : undefined,
      },
    };
  }

  return (
    <div css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden`}>
      <section css={css`flex: 1;min-height: 132px; display: flex; flex-flow: column nowrap; overflow-y: auto;`}>
        <Tree
          css={{ flex: 1 }}
          contents={repoNodes}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick} />
      </section>

      <section
          className={Classes.ELEVATION_3}
          css={css`flex: 0; height: 370px; display: flex; flex-flow: column nowrap;`}>
        <PanelStack
          key={JSON.stringify({ selectedItem, selectedRepo, selectedRepoPaneronMeta, isBusy })}
          css={css`flex: 1;`}
          initialPanel={detailsPanel || {
            component: AddRepo,
            title: "Initialize new repository",
            props: {
              onStartNew: handleStartNewRepo,
              onAddShared: handleAddSharedRepo,
            },
          }} />
      </section>
    </div>
  );
};


const DatasetLabel: React.FC<{ workingCopyPath: string, datasetPath: string }> =
function ({ workingCopyPath, datasetPath }) {
  const _path = datasetPath === '.' ? undefined : datasetPath;
  const datasetInfo = getDatasetInfo.renderer!.useValue({
    workingCopyPath,
    datasetPath: _path,
  }, { info: null });

  if (datasetInfo.value) {
    return <>{datasetInfo.value.info?.title}</>;
  } else {
    return <>{datasetPath}</>;
  }
}


const DatasetDetails: React.FC<IPanelProps & {
  workingCopyPath: string
  datasetPath?: string
  onOpen?: () => void
}> = function ({ workingCopyPath, datasetPath, onOpen }) {
  const _path = datasetPath === '.' ? undefined : datasetPath;

  const datasetInfo = getDatasetInfo.renderer!.useValue({
    workingCopyPath,
    datasetPath: _path,
  }, { info: null });

  const pluginInfo = getPluginInfo.renderer!.useValue({
    id: datasetInfo.value.info?.type.id ?? '',
  }, { plugin: null });

  return (
    <div css={css`flex: 1; overflow-y: auto; display: flex; flex-flow: column nowrap;`}>
      <SeparatedSubpanel css={css`background: white; z-index: 2;`}>
        <H3 className={datasetInfo.isUpdating ? Classes.SKELETON : undefined}>
          {datasetInfo.value?.info?.title || '(Untitled dataset)'}
        </H3>
        <FormGroup css={css`margin-bottom: 0;`} helperText="You can also double-click the dataset in the list above.">
          <Button fill intent="success" disabled={!onOpen || !pluginInfo.value.plugin} onClick={onOpen}>
            Launch dataset in new window
          </Button>
        </FormGroup>
      </SeparatedSubpanel>

      <SeparatedSubpanel css={css`flex: 1; align-contents: flex-end;`}>
        {pluginInfo.value.plugin
          ? <DatasetExtension full extension={pluginInfo.value.plugin} />
          : <DatasetExtension />}
      </SeparatedSubpanel>
    </div>
  )
}


const DatasetExtensionBrowser: React.FC<IPanelProps & { onSelect?: (extension: Extension) => void }> =
function ({ closePanel, onSelect }) {
  const [searchString, setSearchString] = useState('');
  const extensionResp = listAvailablePlugins.renderer!.useValue({}, { extensions: [] });
  const extensions = extensionResp.value.extensions.filter(ext => {
    const str = searchString.toLowerCase();
    if (str.trim().length < 3) {
      return ext.featured;
    } else {
      return (
        ext.title.toLowerCase().indexOf(str) >= 0 ||
        ext.description.toLowerCase().indexOf(str) >= 0 ||
        ext.author.toLowerCase().indexOf(str) >= 0 ||
        ext.npm.name.toLowerCase().indexOf(str) >= 0);
    }
  });

  return (
    <div css={css`
        flex: 1;
        display: flex;
        flex-flow: column nowrap;
        overflow: hidden;
      `}>
      <div css={css`padding: .15rem 1rem .75rem 1rem; z-index: 1; background: white;`} className={Classes.ELEVATION_1}>
        <InputGroup
          fill
          round
          leftIcon="search"
          placeholder="Search…"
          rightElement={
            <Button minimal disabled={searchString.trim() === ''} onClick={() => setSearchString('')} icon="cross" />
          }
          value={searchString}
          onChange={(evt: React.FormEvent<HTMLInputElement>) => setSearchString(evt.currentTarget.value)} />
      </div>
      <div css={css`flex: 1; overflow-y: auto; padding: 1rem; background: ${Colors.LIGHT_GRAY1};`}>
        {extensionResp.isUpdating
          ? <>
              {/* Placeholders */}
              <DatasetExtensionCardInBrowser />
              <DatasetExtensionCardInBrowser />
              <DatasetExtensionCardInBrowser />
            </>
          : extensions.map(ext =>
              <DatasetExtensionCardInBrowser
                searchString={searchString.trim().length < 3 ? undefined : searchString}
                full={extensions.length === 1 ? true : undefined}
                extension={ext}
                key={ext.title}
                onSelect={onSelect ? () => onSelect!(ext) : undefined} />
            )
          }
      </div>
    </div>
  );
}


const DatasetExtensionCardInBrowser:
React.FC<DatasetExtensionCardProps & { onSelect?: () => void }>
= function (props) {
  return (
    <Card
        interactive={props.onSelect !== undefined}
        onClick={props.onSelect}
        css={css`margin-bottom: .5rem`}>
      <DatasetExtension {...props} />
    </Card>
  )
}


const InitializeDataset: React.FC<IPanelProps & {
  repo: Repository
  paneronRepo: PaneronRepository
  extension: Extension
  onComplete: (datasetPath: string) => void
}> = function ({ closePanel, repo, paneronRepo, extension, onComplete }) {
  const [datasetPath, setDatasetPath] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const pluginInfo = getPluginInfo.renderer!.useValue({ id: extension.npm.name }, { plugin: null });
  const installedVersion = pluginInfo.value.plugin?.installedVersion;

  pluginsUpdated.renderer!.useEvent(async ({ changedIDs }) => {
    if (!changedIDs || changedIDs.indexOf(extension?.npm.name) >= 0) {
      pluginInfo.refresh();
    }
  }, []);

  const checkResult = proposeDatasetPath.renderer!.useValue({
    workingCopyPath: repo.workingCopyPath,
    datasetPath,
  }, { path: undefined });

  const canInitialize = (
    !busy &&
    installedVersion &&
    (datasetPath || '').trim() !== '' &&
    (datasetPath || '').indexOf('/') < 0 &&
    checkResult.value.path !== undefined);

  async function handleOperation(func: () => Promise<void>) {
    setBusy(true);
    try {
      await func();
    } finally {
      setBusy(false);
    }
  }

  async function handleInitialize() {
    if (title && checkResult.value.path) {
      await initializeDataset.renderer!.trigger({
        workingCopyPath: repo.workingCopyPath,
        meta: {
          title,
          type: {
            id: extension.npm.name,
            version: extension.npm.version,
          },
        },
        datasetPath: checkResult.value.path,
      });
      setDatasetPath(undefined);
      onComplete(checkResult.value.path);
      closePanel();
    }
  }

  // async function handleCheckPath() {
  //   await proposeDatasetPath.renderer!.trigger({
  //     workingCopyPath: repo.workingCopyPath,
  //     datasetPath: datasetPath,
  //   });
  // }

  return (
    <div css={{ textAlign: 'left', padding: '1rem', overflowY: 'auto' }}>
      <div css={css`margin-bottom: 1rem;`}>
        <DatasetExtension full extension={extension} />
      </div>

      <FormGroup
          label="Dataset title:"
          helperText={<>
            This can be descriptive of dataset purpose.
          </>}>
        <InputGroup
          fill
          value={title}
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setTitle(evt.currentTarget.value)} />
      </FormGroup>

      <FormGroup
          label="Dataset location:"
          helperText={<>
            Repository and location inside that repository where the dataset will live.
            This repository contains {Object.keys(paneronRepo.datasets || []).length} other dataset(s).
          </>}>
        <ControlGroup fill>
          <Button disabled icon="git-repo" />
          <Tooltip content="Repository">
            <InputGroup
              disabled
              value={paneronRepo.title} />
          </Tooltip>
          <InputGroup
            fill
            value={datasetPath || ''}
            onChange={(evt: React.FormEvent<HTMLInputElement>) =>
              setDatasetPath(forceSlug(evt.currentTarget.value))} />
          <Button disabled icon={checkResult.value.path !== undefined ? "tick-circle" : "blank"} />
        </ControlGroup>
      </FormGroup>

      <Button
          disabled={!canInitialize}
          large
          intent={canInitialize ? 'success' : undefined}
          onClick={() => handleOperation(handleInitialize)}>
        Initialize
      </Button>
    </div>
  );
}


const RepoDetails: React.FC<IPanelProps & { repo: Repository, paneronRepo?: PaneronRepository, onEdit?: () => void }> =
function ({ onEdit, repo, paneronRepo }) {
  const [deletionError, setDeletionError] = useState<string | undefined>(undefined);

  async function handleDelete() {
    try {
      await deleteRepository.renderer!.trigger({ workingCopyPath: repo.workingCopyPath });
    } catch (e) {
      setDeletionError(e.message);
    }
  }
  return (
    <div css={css`flex: 1; overflow-y: auto;`}>
      <SeparatedSubpanel>
        {paneronRepo
          ? <>
              <H3>{paneronRepo?.title || '(Untitled repository)'}</H3>
              <p>There are {Object.keys(paneronRepo?.datasets || []).length} dataset(s) in this repository.</p>
              <Button fill disabled={!onEdit} onClick={onEdit}>Edit repository</Button>
            </>
          : <InvalidPaneronRepository repo={repo} />}
      </SeparatedSubpanel>

      <SeparatedSubpanel>
        <AuthorDetails
          workingCopyPath={repo.workingCopyPath}
          name={repo.author?.name}
          email={repo.author?.email} />
      </SeparatedSubpanel>

      <SeparatedSubpanel>
        <ShareRepoForm repo={repo} />
      </SeparatedSubpanel>

      <SeparatedSubpanel>
        <FormGroup
            label={<H4>Working directory</H4>}
            helperText="Please do not modify contents of working directory outside of Paneron.">
          <ControlGroup>
            <InputGroup disabled fill value={repo.workingCopyPath} />
            <Button onClick={() => remote.shell.openPath(repo.workingCopyPath)}>Reveal location</Button>
          </ControlGroup>
        </FormGroup>

        <FormGroup helperText={deletionError} intent={deletionError ? 'danger' : undefined}>
          <Button intent="danger" fill onClick={handleDelete}>
            Delete working directory
          </Button>
        </FormGroup>
      </SeparatedSubpanel>

    </div>
  );
};


/* Shows a notice about invalid Paneron repository, and checks for possible legacy repo. */
const InvalidPaneronRepository: React.FC<{ repo: Repository }> = function ({ repo }) {

  // TODO: These are unnecessary now.
  const busy = false;
  const error = undefined;

  const legacyMetaResp = getBufferDataset.renderer!.useValue({
    workingCopyPath: repo.workingCopyPath,
    paths: ['meta.yaml'],
  }, {});

  const legacyMetaRaw = legacyMetaResp.value['meta.yaml'];
  let legacyMeta: Record<string, any> | null;

  if (legacyMetaRaw) {
    legacyMeta = deserializeMeta(legacyMetaRaw);
  } else {
    legacyMeta = null;
  }

  const writeAccess = !repo.remote || (repo.remote?.writeAccess === true);

  const legacyMetaFound = legacyMeta?.pluginID !== undefined;

  async function handleUpgrade() {
    remote.shell.openExternal('https://paneron.com/docs/migrating-repository-format/');
  }

  return (
    <>
      <Callout title={legacyMetaFound ? "Upgrade required" : "Unknown repository format"}>
        {legacyMetaFound
          ? <>
              <p>This repository was created with an older version of Paneron.</p>
              {writeAccess
                ? <>
                    <FormGroup
                        intent={error ? 'danger' : undefined}
                        helperText={
                          error
                            ? <p>{error}</p>
                            : <p>Make sure to notify your collaborators before you do.</p>
                        }>
                      <Button onClick={handleUpgrade} loading={busy} fill>
                        Read how to upgrade repository format
                      </Button>
                    </FormGroup>
                  </>
                : <p>You can suggest repository owner to upgrade.</p>}
            </>
          : <p>This Git repository is missing Paneron metadata.</p>}
      </Callout>
    </>
  );
};


const EditRepository: React.FC<IPanelProps & { repo: Repository, paneronRepo: PaneronRepository }> =
function ({ closePanel, repo, paneronRepo }) {
  const [editedTitle, editTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const canSaveTitle = !busy && editedTitle.trim() !== '' && editedTitle !== paneronRepo.title;

  const datasetPaths = Object.keys(paneronRepo.datasets || {});

  async function handleOperation(func: () => Promise<void>) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await func();
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle() {
    if (editedTitle.trim() !== '') {
      await setPaneronRepositoryInfo.renderer!.trigger({
        workingCopyPath: repo.workingCopyPath,
        info: {
          title: editedTitle,
        },
      });
      closePanel();
    }
  }

  async function _deleteDataset(datasetPath: string) {
    await deleteDataset.renderer!.trigger({
      workingCopyPath: repo.workingCopyPath,
      datasetPath,
    });
    closePanel();
  }

  return (
    <Subpanel>
      <FormGroup label="Repository title:">
        <InputGroup
          fill
          rightElement={
            <Button
                disabled={!canSaveTitle}
                intent={canSaveTitle ? 'primary' : undefined}
                onClick={() => handleOperation(saveTitle)}>
              Save
            </Button>
          }
          value={editedTitle || paneronRepo.title}
          required
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            editTitle(evt.currentTarget.value)
          } />
      </FormGroup>

      {datasetPaths.length > 0
        ? <FormGroup
              label="Datasets:"
              intent="danger"
              labelInfo="(advanced)"
              helperText={<>
                <p>Deleting datasets is not recommended and may disrupt integrations and collaboration, but you can do it here.</p>
              </>}>
            <UL>
              {datasetPaths.map((dPath, idx) =>
                <li key={idx}>
                  <InputGroup leftIcon="database" fill readOnly value={dPath} rightElement={
                    <Button
                      intent="danger"
                      icon="trash"
                      minimal
                      disabled={busy}
                      onClick={() => handleOperation(() => _deleteDataset(dPath))} />
                  } />
                </li>
              )}
            </UL>
          </FormGroup>
        : null}
    </Subpanel>
  )
}


const AddRepo: React.FC<IPanelProps & { onStartNew: () => void, onAddShared: () => void }> =
function ({ onStartNew, onAddShared }) {
  return (
    <NonIdealState
      description={
        <Menu>
          <MenuItem onClick={onAddShared} text="Add shared repository" icon="globe-network" />
          <MenuItem onClick={onStartNew} text="Start new repository" icon="document" />
          <MenuItem disabled text="Add local working copy" icon="folder-open" />
        </Menu>
      }
    />
  );
};
const AddSharedRepo: React.FC<IPanelProps & { onAdd: (workingCopyPath: string) => void }> =
function ({ closePanel, onAdd }) {
  return (
    <Subpanel>
      <AddSharedRepoForm onCreate={(path) => { onAdd(path); setImmediate(closePanel) }} />
    </Subpanel>
  );
};
const StartNewRepo: React.FC<IPanelProps> =
function ({ closePanel }) {
  return (
    <Subpanel>
      <StartNewRepoForm onCreate={() => { setImmediate(closePanel) }} />
    </Subpanel>
  );
};


const Subpanel = styled.div`
  padding: 1rem;
  overflow-y: auto; 

  .bp3-form-group:last-child {
    margin-bottom: 0;
  }
`;

const SeparatedSubpanel: React.FC<{ className?: string }> = function ({ children, className }) {
  return <Subpanel
      css={css`background: ${Colors.LIGHT_GRAY5}`}
      className={`${Classes.ELEVATION_1} ${className || ''}`}>
    {children}
  </Subpanel>
}


export default Window;


interface NodeData {
  type: 'repository' | 'dataset' | 'newrepository' | 'newdataset'
  workingCopyPath?: string
  datasetPath?: string
}

interface DatasetNodeData extends NodeData {
  type: 'dataset'
  workingCopyPath: string
  // Missing dataset implies that dataset spans the whole repository.
  datasetPath?: string 
}

interface NewDatasetNodeData extends NodeData {
  type: 'newdataset'
  workingCopyPath: string
}
