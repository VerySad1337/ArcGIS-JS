import { render, screen } from "@testing-library/react";
import SidePanel from "./SidePanel";

describe("SidePanel", () => {
  test("renders the app title and children", () => {
    render(
      <SidePanel>
        <div>child content</div>
      </SidePanel>
    );

    expect(screen.getByText("ArcGIS ReactJS Learning")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  test("renders without children", () => {
    render(<SidePanel />);
    expect(screen.getByText("ArcGIS ReactJS Learning")).toBeInTheDocument();
  });
});
