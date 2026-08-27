import { CONNECTION_STATUS } from '../constants/websocket.js';

const LABELS = {
  [CONNECTION_STATUS.CONNECTING]: 'Connecting',
  [CONNECTION_STATUS.LIVE]: 'Live',
  [CONNECTION_STATUS.RECONNECTING]: 'Reconnecting',
  [CONNECTION_STATUS.OFFLINE]: 'Offline',
};

export function ConnectionStatus({ status }) {
  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {LABELS[status] ?? status}
    </span>
  );
}
