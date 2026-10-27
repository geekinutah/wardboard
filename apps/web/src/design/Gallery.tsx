import { useState, type ReactElement } from 'react';
import { Canvas, useCamera, type SelectTarget } from '../features/canvas/Canvas.tsx';
import type { Camera, ZoomTarget } from '../features/canvas/camera.ts';
import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { PersonCard } from './PersonCard.tsx';
import { RemovedCard } from './RemovedCard.tsx';
import { VacancySlot } from './VacancySlot.tsx';
import './gallery.css';

export function Gallery(): ReactElement {
  return (
    <main className="wb-gallery">
      <div className="wb-gallery-inner">
        <h1>Components</h1>

        <section className="wb-gallery-section" aria-labelledby="gallery-people">
          <h2 id="gallery-people" className="wb-section-label">
            People
          </h2>
          <div className="wb-gallery-grid">
            <PersonCard
              name="Ada Fictional"
              callingTitle="Relief Society teacher"
              tags={['Weekday', 'Teaching']}
            />
            <PersonCard name="Ben Example" callingTitle="Primary teacher" needsApproval />
            <PersonCard name="Cleo" callingTitle="Pianist" />
            <PersonCard name="Dana Sample" callingTitle="Elders Quorum secretary" proposed />
            <PersonCard name="Erin Placeholder" callingTitle="Ward pianist" release />
          </div>
        </section>

        <section className="wb-gallery-section" aria-labelledby="gallery-vacancies">
          <h2 id="gallery-vacancies" className="wb-section-label">
            Vacancies
          </h2>
          <div className="wb-gallery-grid">
            <VacancySlot title="Secretary" />
            <VacancySlot title="2nd Counselor" />
          </div>
        </section>

        <section className="wb-gallery-section" aria-labelledby="gallery-removed">
          <h2 id="gallery-removed" className="wb-section-label">
            Removed
          </h2>
          <div className="wb-gallery-grid">
            <PersonCard name="Finn Invented" callingTitle="Music leader" removed />
            <PersonCard name="Greta Nobody" callingTitle="Chorister" removed proposed />
            <RemovedCard name="Hana Sample" callingTitle="Activities chair" kind="position" />
          </div>
        </section>

        <section className="wb-gallery-section" aria-labelledby="gallery-chips">
          <h2 id="gallery-chips" className="wb-section-label">
            Chips
          </h2>
          <div className="wb-chip-row">
            <Chip variant="tag" label="Teaching" />
            <Chip variant="proposed" label="+ Proposed" />
            <Chip variant="release" label={'\u2212 Release'} />
            <Chip variant="needs-approval" label="Needs approval" />
            <Chip variant="vacancy" label="Vacant" />
          </div>
        </section>

        <section className="wb-gallery-section" aria-labelledby="gallery-buttons">
          <h2 id="gallery-buttons" className="wb-section-label">
            Buttons
          </h2>
          <div className="wb-button-row">
            <Button variant="primary">Save</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="ghost">More</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
        </section>

        <CanvasSection />
      </div>
    </main>
  );
}

const ORGS = [
  { id: 'relief-society', name: 'Relief Society', vacancies: 3 },
  { id: 'primary', name: 'Primary', vacancies: 5 },
  { id: 'sunday-school', name: 'Sunday School', vacancies: 1 },
  { id: 'elders-quorum', name: 'Elders Quorum', vacancies: 2 },
] as const;

const GROUPS = [
  { id: 'teachers', name: 'Teachers', filled: 9, vacant: 3 },
  { id: 'nursery', name: 'Nursery', filled: 2, vacant: 1 },
  { id: 'music', name: 'Music', filled: 1, vacant: 1 },
] as const;

const MEMBERS = [
  { id: 'ada-fictional', name: 'Ada Fictional', calling: 'Age 7' },
  { id: 'ben-example', name: 'Ben Example', calling: 'Age 8' },
  { id: 'cleo-sample', name: 'Cleo Sample', calling: 'Age 10' },
  { id: 'dana-sample', name: 'Dana Sample', calling: 'Age 6' },
] as const;

function orgName(id: string | null): string {
  if (id === null) return 'Unknown organization';
  const org = ORGS.find((item) => item.id === id);
  return org === undefined ? id : org.name;
}

function groupName(id: string | null): string {
  if (id === null) return 'Unknown group';
  const group = GROUPS.find((item) => item.id === id);
  return group === undefined ? id : group.name;
}

function memberName(id: string): string {
  const member = MEMBERS.find((item) => item.id === id);
  return member === undefined ? id : member.name;
}

function labelForSelect(target: SelectTarget): string {
  if (target.kind === 'org') return orgName(target.id);
  if (target.kind === 'group') return groupName(target.id);
  return memberName(target.id);
}

function CanvasDemoContent({
  camera,
  selection,
}: {
  camera: Camera;
  selection: ZoomTarget | null;
}): ReactElement {
  if (camera.level === 1) {
    return (
      <div className="wb-canvas-demo">
        <div className="wb-canvas-demo-orgs">
          {ORGS.map((org) => {
            const selected = selection?.kind === 'org' && selection.id === org.id;
            return (
              <div
                key={org.id}
                className="wb-canvas-demo-tile"
                data-zoom-target={`org:${org.id}`}
                data-selected={selected ? 'true' : 'false'}
              >
                <span className="wb-canvas-demo-title">{org.name}</span>
                <span className="wb-canvas-demo-vacant">{org.vacancies} vacant</span>
                {selected ? <span className="wb-canvas-demo-selected">Selected</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (camera.level === 2) {
    return (
      <div className="wb-canvas-demo">
        <p className="wb-canvas-demo-heading">{orgName(camera.orgId)}</p>
        <div className="wb-canvas-demo-groups">
          {GROUPS.map((group) => {
            const selected = selection?.kind === 'group' && selection.id === group.id;
            return (
              <div
                key={group.id}
                className="wb-canvas-demo-group"
                data-zoom-target={`group:${group.id}`}
                data-selected={selected ? 'true' : 'false'}
              >
                <span className="wb-canvas-demo-title">{group.name}</span>
                <span className="wb-canvas-demo-counts">
                  {group.filled} filled · {group.vacant} vacant
                </span>
                {selected ? <span className="wb-canvas-demo-selected">Selected</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="wb-canvas-demo">
      <p className="wb-canvas-demo-heading">
        {orgName(camera.orgId)} · {groupName(camera.groupId)}
      </p>
      <div className="wb-canvas-demo-people">
        {MEMBERS.map((member) => (
          <div key={member.id} className="wb-canvas-demo-member" data-member-id={member.id}>
            <PersonCard name={member.name} callingTitle={member.calling} />
          </div>
        ))}
        <VacancySlot title="Age 9" />
        <VacancySlot title="Age 11" />
      </div>
    </div>
  );
}

function CanvasSection(): ReactElement {
  const [camera, onCameraChange] = useCamera();
  const [selection, setSelection] = useState<ZoomTarget | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  return (
    <section className="wb-gallery-section" aria-labelledby="gallery-canvas">
      <h2 id="gallery-canvas" className="wb-section-label">
        Canvas
      </h2>
      <p className="wb-gallery-canvas-status">
        <span>Selected: {selectedLabel ?? 'none'}</span>
        <span>Notes: {notes ?? 'none'}</span>
      </p>
      <div className="wb-gallery-canvas-frame">
        <Canvas
          camera={camera}
          onCameraChange={onCameraChange}
          selection={selection}
          onSelect={(target) => {
            setSelectedLabel(labelForSelect(target));
            if (target.kind === 'member') return;
            setSelection(target);
          }}
          onOpenNotes={(memberId) => {
            setNotes(memberName(memberId));
          }}
          renderLevel={(current) => <CanvasDemoContent camera={current} selection={selection} />}
        />
      </div>
    </section>
  );
}
