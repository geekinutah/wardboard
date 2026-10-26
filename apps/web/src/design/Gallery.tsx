import type { ReactElement } from 'react';
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
      </div>
    </main>
  );
}
