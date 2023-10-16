"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import z from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { RefObject, useState } from "react";
import { Timestamp, doc, getDoc, writeBatch } from "firebase/firestore";
import { db } from "@/data/firebase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import slugify from "slugify";
import { useUser } from "@auth0/nextjs-auth0/client";
import { roundRobinTournament } from "@/lib/utils";

export default function AddTournamentForm({
  closeRef,
}: {
  closeRef: RefObject<HTMLElement>;
}) {
  const router = useRouter();
  const { user } = useUser();

  const schema = z.object({
    title: z
      .string()
      .min(3, "Tournament title must be at least 3 characters long")
      .refine(async (value) => {
        if (value.length === 0) {
          setSlug("");
          return false;
        }
        const newSlug = slugify(value, {
          lower: true,
          remove: /[*+~.()'"!:@/]/g,
        });
        setSlug(newSlug);

        const tournamentRef = doc(db, "tournaments", newSlug);
        try {
          const tournamentSnapshot = await getDoc(tournamentRef);
          if (tournamentSnapshot.exists()) {
            return false;
          }
          return true;
        } catch (error) {
          console.error(error);
          return false;
        }
      }, "Choose a different title"),
    players: z
      .string()
      .includes(";", {
        message: "Players must be separated by a semicolon (;)",
      })
      .refine(
        (value) =>
          value.split(";").length >= 4 &&
          value.split(";").length <= 8 &&
          value.split(";").every((player) => player.length > 0),
        {
          message:
            "Tournament must have at least 4 players and at most 8 players",
        }
      ),
    pointSystem: z.enum(["football", "chess", "basketball"], {
      required_error: "You must select a point system",
    }),
  });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    delayError: 250,
    mode: "onChange",
    defaultValues: {
      title: "",
      players: "",
    },
    shouldUnregister: true,
  });

  async function onSubmit(values: z.infer<typeof schema>) {
    if (!user) {
      toast.error("You must be logged in to create a tournament.");
      return;
    }
    const { title, players, pointSystem } = values;

    const formattedPlayers: Player[] = players.split(";").map((player, i) => {
      return {
        id: i,
        name: player,
        points: 0,
      };
    });

    let numberOfRounds: number;
    switch (formattedPlayers.length) {
      case 8:
      case 7:
        numberOfRounds = 7;
        break;
      case 6:
      case 5:
        numberOfRounds = 5;
        break;
      default:
        numberOfRounds = 3;
        break;
    }

    const rounds: Round[] = roundRobinTournament(formattedPlayers);

    const batch = writeBatch(db);

    const tournament = {
      slug,
      title,
      userSub: user.sub,
      players: formattedPlayers,
      pointSystem,
      timestamp: Timestamp.now().toMillis(),
    };

    batch.set(doc(db, "tournaments", tournament.slug), tournament);

    rounds.forEach((round) => {
      const roundRef = doc(
        db,
        "tournaments",
        tournament.slug,
        "rounds",
        round.id.toString()
      );
      batch.set(roundRef, {
        id: round.id,
      });

      round.pairs.forEach((pair) => {
        const pairRef = doc(
          db,
          "tournaments",
          tournament.slug,
          "rounds",
          round.id.toString(),
          "pairs",
          pair.id.toString()
        );

        batch.set(pairRef, pair);
      });
    });

    const batchPromise = batch.commit();
    toast.promise(batchPromise, {
      loading: "Creating...",
      success: "Created!",
      error: "Error creating.",
    });

    try {
      await batchPromise;
      closeRef.current?.click();
      router.refresh();
    } catch (error) {
      console.error(error);
    }
  }

  const [slug, setSlug] = useState<string>("");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input
                  placeholder="Chess"
                  // onChange={(e) => setSlug(slugify(e.target.value))}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                URL: <span className="font-mono">{"/tournaments/" + slug}</span>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="players"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Players</FormLabel>
              <FormControl>
                <Textarea
                  className="resize-none"
                  placeholder="John;Jane;..."
                  {...field}
                />
              </FormControl>
              <FormDescription>
                These are your tournament players.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="pointSystem"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Players</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a point system" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="football">Football (3/1/0)</SelectItem>
                  <SelectItem value="chess">Chess (1/0,5/0)</SelectItem>
                  <SelectItem value="basketball">Basketball (2/0/1)</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                These are your tournament players.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          className="hover:scale-105 active:scale-100 transition-all duration-75"
          type="submit"
        >
          Submit
        </Button>
      </form>
    </Form>
  );
}
