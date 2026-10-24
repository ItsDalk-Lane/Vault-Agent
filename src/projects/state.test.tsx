import React, { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { flushSync } from "react-dom";
import type { ProjectFileRecord } from "@/projects/type";
import {
  subscribeToProjectRecords,
  updateCachedProjectRecords,
  useProjects,
} from "@/projects/state";

interface ProjectViewProps {
  activeId: string | null;
  onProjectGone: () => void;
}

function ProjectView({ activeId, onProjectGone }: ProjectViewProps) {
  const projects = useProjects();
  const project = projects.find((entry) => entry.id === activeId);
  const orphaned = activeId !== null && !project;
  useEffect(() => {
    if (orphaned) onProjectGone();
  }, [orphaned, onProjectGone]);
  return <div>{project?.name ?? "Home"}</div>;
}

const projectRecord = (name = "New project"): ProjectFileRecord => ({
  project: { id: "new-project", name } as ProjectFileRecord["project"],
  filePath: "projects/new/project.md",
  folderName: "new",
});

describe("state", () => {
  describe("useProjects()", () => {
    beforeEach(() => act(() => updateCachedProjectRecords([])));
    afterEach(() => act(() => updateCachedProjectRecords([])));

    it("reads the new project during a manager-triggered synchronous render before its own subscription runs https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const onProjectGone = jest.fn();
      let rerender!: (view: React.ReactElement) => void;
      const unsubscribeManager = subscribeToProjectRecords(() => {
        // eslint-disable-next-line @eslint-react/dom/no-flush-sync -- 仅用于重现外部存储通知先于项目列表订阅的同步渲染顺序。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        flushSync(() =>
          rerender(<ProjectView activeId="new-project" onProjectGone={onProjectGone} />)
        );
      });
      const view = render(<ProjectView activeId={null} onProjectGone={onProjectGone} />);
      rerender = view.rerender;
      try {
        act(() => updateCachedProjectRecords([projectRecord()]));
        expect(screen.getByText("New project")).toBeTruthy();
        expect(onProjectGone).not.toHaveBeenCalled();
      } finally {
        unsubscribeManager();
        view.unmount();
      }
    });

    it("reports an actually deleted active project once and follows subsequent renames without false warnings https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      updateCachedProjectRecords([projectRecord()]);
      const onProjectGone = jest.fn();
      const view = render(<ProjectView activeId="new-project" onProjectGone={onProjectGone} />);
      act(() => updateCachedProjectRecords([projectRecord("Renamed project")]));
      expect(screen.getByText("Renamed project")).toBeTruthy();
      expect(onProjectGone).not.toHaveBeenCalled();
      act(() => updateCachedProjectRecords([]));
      expect(onProjectGone).toHaveBeenCalledTimes(1);
      view.rerender(<ProjectView activeId="new-project" onProjectGone={onProjectGone} />);
      expect(onProjectGone).toHaveBeenCalledTimes(1);
    });
  });
});
