import * as readline from "node:readline";
import type { Colleague, ChannelBinding, Turn, Reply } from "../colleague/types.js";
import { type Channel, makeTurn } from "./channel.js";

/**
 * ConsoleChannel — an interactive terminal channel. Always available, needs no
 * credentials. It's the "Claw3D"/WebChat equivalent for local development: you
 * talk to the colleague, it talks back, exactly as it would on Slack.
 */
export class ConsoleChannel implements Channel {
  readonly kind = "console";
  private rl?: readline.Interface;

  async start(
    colleague: Colleague,
    _binding: ChannelBinding,
    onTurn: (turn: Turn) => Promise<Reply>,
  ): Promise<void> {
    const { person } = colleague;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.rl = rl;

    console.log(
      `\n${person.name} <${person.handle}> — ${person.role}\n` +
        `${person.mandate}\n` +
        `(type your message; "/exit" to quit)\n`,
    );

    const threadId = `console:${Date.now()}`;
    const you = process.env.USER || "you";

    const ask = () => {
      rl.question("you › ", async (line) => {
        const text = line.trim();
        if (text === "/exit" || text === "/quit") {
          rl.close();
          return;
        }
        if (!text) return ask();
        const turn = makeTurn("console", threadId, you, text);
        try {
          const reply = await onTurn(turn);
          console.log(`\n${person.handle} › ${reply.text}\n`);
        } catch (err) {
          console.error(`\n[error] ${(err as Error).message}\n`);
        }
        ask();
      });
    };

    await new Promise<void>((resolve) => {
      ask();
      rl.on("close", () => {
        console.log(`\n${person.name} signing off.`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}
