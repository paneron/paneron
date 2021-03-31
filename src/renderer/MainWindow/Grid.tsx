/** @jsx jsx */

import { jsx, css } from '@emotion/core';
import React, { ComponentType } from 'react';
import { FixedSizeGrid as Grid, GridChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { Icon, IIconProps, ITagProps, NonIdealState, Tag } from '@blueprintjs/core';


export interface GridData<P extends Record<string, any> = Record<never, never>> {
  items: string[][] // items chunked into rows
  selectedItem: string | null
  selectItem: (ref: string | null) => void
  openItem?: (ref: string) => void
  cellWidth: number
  cellHeight: number
  padding: number
  extraData: P
}

type ItemDataGetter<P extends Record<string, any> = Record<never, never>> = (width: number) => GridData<P> | null

export interface CellProps<P extends Record<string, any> = Record<never, never>> {
  itemRef: string
  isSelected: boolean
  onSelect?: () => void
  onOpen?: () => void
  height: number
  width: number
  padding: number 
  extraData: P
}

function makeGrid<P extends Record<string, any> = Record<never, never>>
(CellContents: React.FC<CellProps<P>>):
React.FC<{ getGridData: ItemDataGetter<P> }> {

  const Cell: ComponentType<GridChildComponentProps> =
  React.memo(function ({ columnIndex, rowIndex, data, style }) {
    const _data: GridData = data;
    const ref = _data.items[rowIndex][columnIndex];
    if (ref) {
      return (
        <div style={style}>
          <CellContents
            isSelected={_data.selectedItem === ref}
            onSelect={() => _data.selectItem(ref)}
            onOpen={() => data.openRepo(ref)}
            height={_data.cellHeight}
            width={_data.cellWidth}
            padding={_data.padding}
            extraData={_data.extraData as P}
            itemRef={ref} />
        </div>
      );
    } else {
      return null;
    }
  }, areEqual);

  return ({ getGridData }) => (
    <AutoSizer>
      {({ width, height }) => {
        const gridData = getGridData(width);
        if (gridData) {
          const columnCount = (gridData.items[0] ?? []).length;
          const rowCount = gridData.items.length;
          return (
            <Grid
                width={width}
                height={height}
                columnCount={columnCount}
                columnWidth={gridData.cellWidth}
                rowCount={rowCount}
                rowHeight={gridData.cellHeight}
                itemKey={({ columnIndex, rowIndex }) => {
                  const workDir = gridData.items[rowIndex][columnIndex];
                  if (!workDir) {
                    return columnIndex * rowIndex;
                  }
                  return workDir;
                }}
                itemData={gridData}>
              {Cell}
            </Grid>
          );
        } else {
          return <NonIdealState title="Nothing to show" icon="heart-broken" />;
        }
      }}
    </AutoSizer>
  )
}


interface LabelledGridIconProps {
  isSelected: boolean
  onSelect?: () => void
  onOpen?: () => void
  iconProps?: IIconProps
  tagProps?: ITagProps
  height: number
  width: number
  padding: number 
}

export const LabelledGridIcon: React.FC<LabelledGridIconProps> =
function ({ isSelected, onSelect, onOpen, height, padding, tagProps, iconProps, children }) {
  return (
    <div
        css={css`text-align: center; height: ${height - padding}px; padding: ${padding}px; display: flex; flex-flow: column nowrap; align-items: center; justify-content: space-around;`}>
      <Icon
          iconSize={Icon.SIZE_LARGE}
          icon="blank"
          intent={isSelected ? 'primary' : undefined}
          onDoubleClick={onOpen}
          onClick={onSelect}
          {...iconProps} />
      <Tag
          css={css`cursor: default;`}
          minimal fill
          intent={isSelected ? 'primary' : undefined}
          onDoubleClick={onOpen}
          onClick={onSelect}
          {...tagProps}>
        {children}
      </Tag>
    </div>
  );
};


export default makeGrid;
