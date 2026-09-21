/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {
  mockOperatorGroup,
  mockScanSourceSchema,
  mockViewResultsSchema,
} from "../../../service/operator-metadata/mock-operator-metadata.data";
import {
  mockPoint,
  mockResultPredicate,
  mockScanPredicate,
} from "../../../service/workflow-graph/model/mock-workflow-data";
import { UndoRedoService } from "../../../service/undo-redo/undo-redo.service";
import { DragDropService } from "../../../service/drag-drop/drag-drop.service";
import { ComponentFixture, fakeAsync, TestBed, tick } from "@angular/core/testing";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";
import { OperatorMenuComponent } from "./operator-menu.component";
import { OperatorLabelComponent } from "./operator-label/operator-label.component";
import { OperatorMetadataService } from "../../../service/operator-metadata/operator-metadata.service";
import { StubOperatorMetadataService } from "../../../service/operator-metadata/stub-operator-metadata.service";
import { RouterTestingModule } from "@angular/router/testing";
import { WorkflowActionService } from "../../../service/workflow-graph/model/workflow-action.service";
import { JointUIService } from "../../../service/joint-ui/joint-ui.service";
import { WorkflowUtilService } from "../../../service/workflow-graph/util/workflow-util.service";
import { NzDropDownModule } from "ng-zorro-antd/dropdown";
import { NzCollapseModule } from "ng-zorro-antd/collapse";
import type { NzAutocompleteOptionComponent } from "ng-zorro-antd/auto-complete";
import type * as joint from "jointjs";
import { commonTestProviders } from "../../../../common/testing/test-utils";
import { NextOperatorService } from "../../../service/next-operator/next-operator.service";
import { OperatorSchema } from "../../../types/operator-schema.interface";

/** Answers from a rule table the test sets, so the panel can be tested without fetching the real one. */
class StubNextOperatorService {
  public rules: Record<string, OperatorSchema[]> = {};

  public suggestionsFor(group: string): Promise<{ suggestions: OperatorSchema[]; known: boolean }> {
    return Promise.resolve({ suggestions: this.rules[group] ?? [], known: group in this.rules });
  }
}

describe("OperatorPanelComponent", () => {
  let component: OperatorMenuComponent;
  let fixture: ComponentFixture<OperatorMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        {
          provide: OperatorMetadataService,
          useClass: StubOperatorMetadataService,
        },
        DragDropService,
        WorkflowActionService,
        UndoRedoService,
        WorkflowUtilService,
        JointUIService,
        { provide: NextOperatorService, useClass: StubNextOperatorService },
        ...commonTestProviders,
      ],
      imports: [
        OperatorMenuComponent,
        OperatorLabelComponent,
        NzDropDownModule,
        NzCollapseModule,
        BrowserAnimationsModule,
        RouterTestingModule.withRoutes([]),
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(OperatorMenuComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("should search an operator by its user friendly name", () => {
    component.searchInputValue = "Source: Scan";
    component.onInput({ target: { value: "Source: Scan" } } as unknown as Event);

    expect(component.autocompleteOptions.length).toBe(1);
    expect(component.autocompleteOptions[0]).toBe(mockScanSourceSchema);
  });

  it("should support fuzzy search on operator user friendly name", () => {
    component.searchInputValue = "scan";
    component.onInput({ target: { value: "scan" } } as unknown as Event);

    expect(component.autocompleteOptions.length).toBe(1);
    expect(component.autocompleteOptions[0]).toBe(mockScanSourceSchema);
  });

  /**
   * Selecting one operator offers what usually follows it; choosing a suggestion places it beside the
   * selected operator, wires the two, and selects the new one so the next step is offered in turn.
   */
  describe("suggesting the next operator", () => {
    let stubRules: StubNextOperatorService;
    let workflowActionService: WorkflowActionService;

    const settle = () => new Promise(resolve => setTimeout(resolve));

    beforeEach(() => {
      stubRules = TestBed.inject(NextOperatorService) as unknown as StubNextOperatorService;
      workflowActionService = TestBed.inject(WorkflowActionService);
    });

    async function selectScan(): Promise<void> {
      workflowActionService.addOperator(mockScanPredicate, mockPoint);
      workflowActionService.getJointGraphWrapper().highlightOperators(mockScanPredicate.operatorID);
      await settle();
    }

    it("offers what usually follows the selected operator", async () => {
      stubRules.rules = { Source: [mockViewResultsSchema] };

      await selectScan();

      expect(component.selectedOperatorName).toBe("Source: Scan");
      expect(component.nextSuggestions).toEqual([mockViewResultsSchema]);
    });

    it("says so when the selected operator ends the workflow", async () => {
      stubRules.rules = { Source: [] };

      await selectScan();

      expect(component.nextSuggestions).toEqual([]);
      expect(component.nextStepNote).toContain("ends the workflow");
    });

    it("tells an operator nobody wrote a rule for apart from one that ends the workflow", async () => {
      stubRules.rules = {};

      await selectScan();

      expect(component.nextStepNote).toContain("No suggestions");
    });

    it("clears the suggestions when the selection is cleared", async () => {
      stubRules.rules = { Source: [mockViewResultsSchema] };
      await selectScan();

      workflowActionService.getJointGraphWrapper().unhighlightOperators(mockScanPredicate.operatorID);
      await settle();

      expect(component.nextSuggestions).toEqual([]);
      expect(component.nextStepNote).toBe("");
    });

    it("offers nothing while several operators are selected, since there is no single 'after'", async () => {
      stubRules.rules = { Source: [mockViewResultsSchema] };
      const wrapper = workflowActionService.getJointGraphWrapper();
      workflowActionService.addOperator(mockScanPredicate, mockPoint);
      workflowActionService.addOperator(mockResultPredicate, mockPoint);

      wrapper.setMultiSelectMode(true);
      wrapper.highlightOperators(mockScanPredicate.operatorID, mockResultPredicate.operatorID);
      await settle();

      expect(component.nextSuggestions).toEqual([]);
    });

    it("places a chosen suggestion, wires it to the selected operator and selects it", async () => {
      stubRules.rules = { Source: [mockViewResultsSchema] };
      await selectScan();

      component.addNext(mockViewResultsSchema);

      const graph = workflowActionService.getTexeraGraph();
      const added = graph.getAllOperators().find(op => op.operatorType === mockViewResultsSchema.operatorType);
      expect(added).toBeDefined();
      expect(graph.getAllLinks()).toEqual([
        expect.objectContaining({
          source: { operatorID: mockScanPredicate.operatorID, portID: "output-0" },
          target: expect.objectContaining({ operatorID: added!.operatorID }),
        }),
      ]);
      expect(workflowActionService.getJointGraphWrapper().getCurrentHighlightedOperatorIDs()).toEqual([
        added!.operatorID,
      ]);
    });
  });

  /**
   * The constructor's metadata subscription is what actually populates the panel, and none of it
   * was covered. It filters operator types out, buckets the rest by group, and sorts each bucket -
   * so a regression here silently drops operators from the palette or scrambles their order, with
   * no error anywhere.
   */
  describe("operator list construction", () => {
    it("buckets operators by their group name", () => {
      // Every listed operator must land under its own declared group; a grouping bug would show up
      // as an operator filed under the wrong key rather than as a crash.
      component.opList.forEach((operators, group) => {
        operators.forEach(op => expect(op.additionalMetadata.operatorGroupName).toBe(group));
      });
      expect(component.opList.get("Source")).toBeDefined();
      expect(component.opList.get("Analysis")).toBeDefined();
    });

    it("sorts each group by operatorType", () => {
      // The palette renders in Map order, so an unsorted (or differently sorted) group is a
      // visible reshuffle for users.
      component.opList.forEach(operators => {
        const types = operators.map(op => op.operatorType);
        expect(types).toEqual([...types].sort((a, b) => a.localeCompare(b)));
      });
    });

    it("excludes PythonUDF from both the palette and the search index", () => {
      // PythonUDF is filtered before the list is built AND before fuse.setCollection, so it must be
      // absent from both. Asserting only the palette would miss a filter applied in one place only.
      const listed = [...component.opList.values()].flat().map(op => op.operatorType);
      expect(listed).not.toContain("PythonUDF");

      component.onInput({ target: { value: "Python UDF" } } as unknown as Event);
      expect(component.autocompleteOptions.map(op => op.operatorType)).not.toContain("PythonUDF");
    });

    it("takes its group headings from the metadata, not from the operators present", () => {
      // groupNames drives the collapse panels; deriving it from opList instead would silently drop
      // a heading whenever a group happens to contain no operators.
      expect(component.groupNames).toEqual(mockOperatorGroup);
    });
  });

  describe("workflow modification state", () => {
    it("tracks whether the workflow may be modified", () => {
      const workflowActionService = TestBed.inject(WorkflowActionService);
      expect(component.canModify).toBe(true);

      // The palette disables drag-and-drop on this flag, so a stuck value lets a user drag
      // operators onto a read-only workflow.
      workflowActionService.disableWorkflowModification();
      expect(component.canModify).toBe(false);

      workflowActionService.enableWorkflowModification();
      expect(component.canModify).toBe(true);
    });
  });

  describe("selecting a search result", () => {
    it("places the operator relative to the current pan offset", fakeAsync(() => {
      const workflowActionService = TestBed.inject(WorkflowActionService);
      // Pretend the canvas has been panned; the new operator must land at a fixed point in view
      // space, which means subtracting the paper's translation rather than using raw coordinates.
      vi.spyOn(workflowActionService.getJointGraphWrapper(), "getMainJointPaper").mockReturnValue({
        translate: () => ({ tx: 100, ty: 25 }),
      } as unknown as joint.dia.Paper);
      const addOperator = vi.spyOn(workflowActionService, "addOperator");

      component.onSelectionChange({
        nzValue: mockScanSourceSchema,
      } as unknown as NzAutocompleteOptionComponent);

      expect(addOperator).toHaveBeenCalledTimes(1);
      expect(addOperator.mock.calls[0][1]).toEqual({ x: 300, y: 175 });
      tick(0);
    }));

    it("falls back to the untranslated point when no paper is attached", fakeAsync(() => {
      const workflowActionService = TestBed.inject(WorkflowActionService);
      vi.spyOn(workflowActionService.getJointGraphWrapper(), "getMainJointPaper").mockReturnValue(
        undefined as unknown as joint.dia.Paper
      );
      const addOperator = vi.spyOn(workflowActionService, "addOperator");

      component.onSelectionChange({
        nzValue: mockScanSourceSchema,
      } as unknown as NzAutocompleteOptionComponent);

      // The ?? 0 guards exist because the paper is absent until the editor mounts.
      expect(addOperator.mock.calls[0][1]).toEqual({ x: 400, y: 200 });
      tick(0);
    }));

    it("clears the search box asynchronously after the selection", fakeAsync(() => {
      const workflowActionService = TestBed.inject(WorkflowActionService);
      vi.spyOn(workflowActionService.getJointGraphWrapper(), "getMainJointPaper").mockReturnValue(
        undefined as unknown as joint.dia.Paper
      );
      component.searchInputValue = "scan";
      component.onInput({ target: { value: "scan" } } as unknown as Event);

      component.onSelectionChange({
        nzValue: mockScanSourceSchema,
      } as unknown as NzAutocompleteOptionComponent);

      // Deliberately still set right after the call: the clear is deferred through setTimeout
      // because ng-zorro re-displays the selected value if it is cleared synchronously.
      expect(component.searchInputValue).toBe("scan");

      tick(0);
      expect(component.searchInputValue).toBe("");
      expect(component.autocompleteOptions).toEqual([]);
    }));
  });

  it("should clear the search box when an operator from search box is dropped", () => {
    component.searchInputValue = "scan";
    component.onInput({ target: { value: "scan" } } as unknown as Event);

    const dragDropService = TestBed.inject(DragDropService);
    (dragDropService as any).operatorDroppedSubject.next();

    expect(component.searchInputValue).toBeFalsy();
  });
});
