import type { MapSnapshot } from '@/types/travel';

export interface NativeOfflineMapProps {
  snapshot: MapSnapshot;
  displaySnapshot: MapSnapshot;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  onSelectSegment?: (segmentId: string) => void;
  onSnapshotChange: (snapshot: MapSnapshot) => void;
}

export const nativeOfflineMapAvailable: boolean;
export function NativeOfflineMap(props: NativeOfflineMapProps): React.ReactElement | null;