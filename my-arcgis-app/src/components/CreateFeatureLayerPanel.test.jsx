import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateFeatureLayerPanel from "./CreateFeatureLayerPanel";

describe("CreateFeatureLayerPanel", () => {
  test("is collapsed by default and reveals the form when the title is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CreateFeatureLayerPanel
        onCreateLayer={jest.fn()}
        signedInUser={{ username: "jdoe", fullName: "Jane Doe" }}
      />
    );

    expect(screen.queryByLabelText("New feature layer name")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create feature layer/i }));

    expect(screen.getByLabelText("New feature layer name")).toBeInTheDocument();
  });

  test("shows a sign-in hint when signed out", async () => {
    const user = userEvent.setup();
    render(<CreateFeatureLayerPanel onCreateLayer={jest.fn()} signedInUser={null} />);

    await user.click(screen.getByRole("button", { name: /create feature layer/i }));

    expect(
      screen.getByText("Sign in with an ArcGIS account to create a new hosted feature layer.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New feature layer name")).not.toBeInTheDocument();
  });

  test("signed-in users can submit the form", async () => {
    const user = userEvent.setup();
    const onCreateLayer = jest.fn().mockResolvedValue();
    render(
      <CreateFeatureLayerPanel
        onCreateLayer={onCreateLayer}
        signedInUser={{ username: "jdoe", fullName: "Jane Doe" }}
      />
    );

    await user.click(screen.getByRole("button", { name: /create feature layer/i }));
    await user.type(screen.getByLabelText("New feature layer name"), "Site Inspections");
    await user.click(screen.getByRole("button", { name: "Create Layer" }));

    expect(onCreateLayer).toHaveBeenCalledWith({ name: "Site Inspections", geometryType: "point", fields: [] });
  });
});
