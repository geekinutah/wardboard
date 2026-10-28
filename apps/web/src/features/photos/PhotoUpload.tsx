import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { PhotoCompareDialog } from './PhotoCompareDialog.tsx';
import type { PhotoMember } from './plan.ts';
import './photos.css';

export type PhotoUploadProps = {
  readonly member: PhotoMember;
  readonly upload: (file: File) => Promise<{ photoRef: string }>;
  readonly assign: (memberId: string, photoRef: string) => Promise<void>;
};

const ACCEPTED = new Set(['image/jpeg', 'image/png']);

function messageOf(caught: unknown): string {
  if (caught instanceof Error && caught.message.length > 0) return caught.message;
  return 'The photo could not be saved.';
}

export function PhotoUpload({ member, upload, assign }: PhotoUploadProps): ReactElement {
  const inputId = useId();
  const urlRef = useRef<string | null>(null);
  const pending = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [incomingUrl, setIncomingUrl] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  function releaseUrl(): void {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  function closeCompare(): void {
    releaseUrl();
    setIncomingUrl(null);
    setFile(null);
    setSuccess(null);
  }

  async function save(next: File, kind: 'added' | 'replaced'): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    try {
      const uploaded = await upload(next);
      await assign(member.id, uploaded.photoRef);
      releaseUrl();
      setIncomingUrl(null);
      setFile(null);
      setSuccess(kind === 'added' ? `Photo added for ${member.name}` : `Using the new photo for ${member.name}.`);
    } catch (caught: unknown) {
      setSuccess(null);
      setError(messageOf(caught));
    } finally {
      pending.current = false;
    }
  }

  function onChoose(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (next === undefined) return;
    if (!ACCEPTED.has(next.type)) {
      closeCompare();
      setError('Choose a JPEG or PNG.');
      return;
    }
    setError(null);
    setSuccess(null);
    if (member.photoRef === null) {
      void save(next, 'added');
      return;
    }
    releaseUrl();
    const url = URL.createObjectURL(next);
    urlRef.current = url;
    setFile(next);
    setIncomingUrl(url);
  }

  return (
    <div className="wb-photo-upload">
      <label className="wb-photo-upload-label" htmlFor={inputId}>{`Upload photo for ${member.name}`}</label>
      <input
        id={inputId}
        className="wb-photo-upload-input"
        type="file"
        accept="image/jpeg,image/png"
        onChange={onChoose}
      />
      {error === null ? null : (
        <p className="wb-photo-upload-alert" role="alert">
          {error}
        </p>
      )}
      {success === null ? null : <p className="wb-photo-upload-success">{success}</p>}
      {incomingUrl === null ? null : (
        <PhotoCompareDialog
          memberName={member.name}
          currentUrl={null}
          incomingUrl={incomingUrl}
          sourceLabel="Direct upload"
          index={1}
          total={1}
          skippedHousehold={0}
          onKeepCurrent={closeCompare}
          onCancelImport={closeCompare}
          onUseNew={() => {
            if (file === null) return;
            void save(file, 'replaced');
          }}
        />
      )}
    </div>
  );
}
