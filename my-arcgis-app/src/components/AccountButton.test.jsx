import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountButton from "./AccountButton";

describe("AccountButton", () => {
  test("renders nothing when OAuth isn't configured", () => {
    const { container } = render(<AccountButton oauthConfigured={false} signedInUser={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("shows a Sign in button when configured and signed out", async () => {
    const user = userEvent.setup();
    const onSignIn = jest.fn();
    render(<AccountButton oauthConfigured={true} signedInUser={null} onSignIn={onSignIn} />);

    await user.click(screen.getByRole("button", { name: "Sign in to ArcGIS" }));

    expect(onSignIn).toHaveBeenCalled();
  });

  test("disables the Sign in button while signing in", () => {
    render(<AccountButton oauthConfigured={true} signedInUser={null} signingIn={true} />);
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
  });

  test("shows the signed-in user's name and a Sign out button once signed in", async () => {
    const user = userEvent.setup();
    const onSignOut = jest.fn();
    render(
      <AccountButton
        oauthConfigured={true}
        signedInUser={{ username: "jdoe", fullName: "Jane Doe" }}
        onSignOut={onSignOut}
      />
    );

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
