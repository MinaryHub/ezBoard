// 캔버스 플로팅 HUD: 우하단 줌 컨트롤 + 하단 중앙 선택 부품 빠른 액션 바
import { useT } from '../i18n';
import type { Part } from '../types';
import Icon from './Icon';

interface Props {
  zoomPct: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  selectedPart?: Part;
  onRotate?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** 실물 보기 뒷면일 때 배지 안내 */
  realBack?: boolean;
  onFlipBack?: () => void;
}

export default function CanvasHud({
  zoomPct,
  onZoomIn,
  onZoomOut,
  onFit,
  selectedPart,
  onRotate,
  onDuplicate,
  onDelete,
  realBack,
  onFlipBack,
}: Props) {
  const t = useT();
  return (
    <>
      {realBack && onFlipBack && (
        <button type="button" className="flip-pill" onClick={onFlipBack} data-tip={t('tip.flip')}>
          <Icon name="flip" size={13} />{t('rb.flipBack')}
        </button>
      )}
      {selectedPart && (
        <div className="sel-bar" role="toolbar" aria-label={selectedPart.ref}>
          <span className="sel-ref">
            <b>{selectedPart.ref}</b>
            {selectedPart.value && <em>{selectedPart.value}</em>}
          </span>
          {onRotate && (
            <button type="button" className="ghost small" onClick={onRotate} data-tip={t('tip.rotate')} aria-label={t('tip.rotate')}>
              <Icon name="rotate" size={14} /><span>{t('sb.rotate')}</span>
            </button>
          )}
          {onDuplicate && (
            <button type="button" className="ghost small" onClick={onDuplicate} data-tip={t('tip.duplicate')} aria-label={t('tip.duplicate')}>
              <Icon name="copy" size={14} /><span>{t('part.duplicate')}</span>
            </button>
          )}
          {onDelete && (
            <button type="button" className="ghost small danger" onClick={onDelete} data-tip={t('tip.delete')} aria-label={t('tip.delete')}>
              <Icon name="trash" size={14} /><span>{t('part.delete')}</span>
            </button>
          )}
        </div>
      )}
      <div className="zoom-hud" role="group" aria-label="Zoom">
        <button type="button" className="ghost small" onClick={onZoomOut} data-tip={t('zoom.out')} aria-label={t('zoom.out')}>
          <Icon name="zoomOut" size={14} />
        </button>
        <button type="button" className="ghost small zoom-pct num" onClick={onFit} data-tip={t('zoom.fit')} aria-label={t('zoom.fit')}>
          {zoomPct}%
        </button>
        <button type="button" className="ghost small" onClick={onZoomIn} data-tip={t('zoom.in')} aria-label={t('zoom.in')}>
          <Icon name="zoomIn" size={14} />
        </button>
      </div>
    </>
  );
}
