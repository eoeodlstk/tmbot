import {
  ApplicationCommandDataResolvable,
  ChatInputCommandInteraction,
  Client,
  Collection,
  Events,
  Interaction,
  REST,
  Routes,
  Snowflake
} from "discord.js";
import { readdirSync } from "fs";
import { join } from "path";
import { Command } from "../interfaces/Command";
import { checkPermissions, PermissionResult } from "../utils/checkPermissions";
import { config } from "../utils/config";
import { i18n } from "../utils/i18n";
import { MissingPermissionsException } from "../utils/MissingPermissionsException";
import { MusicQueue } from "./MusicQueue";

export class Bot {
  public readonly prefix = config.PREFIX;
  public commands = new Collection<string, Command>();
  public slashCommands = new Array<ApplicationCommandDataResolvable>();
  public slashCommandsMap = new Collection<string, Command>();
  public cooldowns = new Collection<string, Collection<Snowflake, number>>();
  public queues = new Collection<Snowflake, MusicQueue>();

  public constructor(public readonly client: Client) {
    this.client.login(config.TOKEN);

    this.client.on("ready", () => {
      console.log(`${this.client.user!.username} ready!`);

      this.registerSlashCommands();
    });
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      let content = message.content;
      // @ts-ignore
      let my_name = message.guild.members.cache.find(member => member.user.username === message.author.username);
      // @ts-ignore
      let admin_role = message.member.roles.cache.has(config.ADMIN_ROLE); // admin role  684722393725665392
      // @ts-ignore
      let subscriber_role = message.member.roles.cache.has(config.SUBSCRIBER_ROLE); // Subscriber role 689661924480516251
      // @ts-ignore
      let superior_role = message.member.roles.cache.has(config.SUPERIOR_ROLE); // Superior role   685336335288107060
      // @ts-ignore
      let web_admin_role = message.member.roles.cache.has(config.WEB_ADMIN_ROLE); // Webadmin role
      // @ts-ignore
      let disco_admin_role = message.member.roles.cache.has(config.DISCO_ADMIN_ROLE); // Discoadmin role
      // @ts-ignore
      let bot_role = message.member.roles.cache.has(config.BOT_ROLE); // bot role   1019970602502725732   684731646288855081
      // @ts-ignore
      let bot_admin_role = message.member.roles.cache.has(config.BOT_ADMIN_ROLE); // botadmn role

      if (admin_role || subscriber_role || superior_role || web_admin_role || disco_admin_role || bot_role || bot_admin_role) return;
      if (
          (
               content.includes("어떻게") || content.includes("문의")
            || content.includes("질문") || content.includes("아시는")
            || content.includes("오또") || content.includes("해결")
          )
          &&
          (
            content.includes("있") || content.includes("까요")
         || content.includes("주") || content.includes("있") || content.includes("합")
         || content.includes("하") || content.includes("할")
          )
      ) {
        if (message.channel.id !== config.QUESTION_CHANNEL) {  // 737654030679015476  간단문의 게시판
          await message.channel.send(`${my_name} 이채널은 문의 채널이 아닙니다.\n 문의채널에 다시 남겨주세요\n<#${config.QUESTION_CHANNEL}> 또는 https://remiz.co.kr/bbs/board.php?bo_table=qna 에 남겨주시기 바랍니다.`);
        }
      }

      let productLinks = config.PRODUCT_LINKS;

      let softwareTypes = config.SOFTWARE_TYPES;
      if (content.includes("인증") || content.includes("크랙") || content.includes("시디키") || content.includes("리팩") || content.includes("과자") ) {
          for (let key in softwareTypes) {
            if (content.includes(key)) {
              // @ts-ignore
              await message.channel.send(`${my_name} 레미쯔 디스코드서버에서는 정품구매 사용을 지향합니다.\n 구매처: ${productLinks[softwareTypes[key]]}`);
              return;
            }
          }
          if ((content.includes("과자") && content.includes("먹")) ||
               (content.includes("인증") && content.includes("님"))) {
            return;
          }
          await message.channel.send(`${my_name} 레미쯔 디스코드서버에서는 정품구매 사용을 지향합니다.`);
          return;
      }
      if ((content.includes("디스코드") || content.includes("디코")) &&
        (content.includes("없어") || content.includes("유지"))) {
          await message.channel.send(`${my_name} 디스코드는 일종의 실시간 채팅방으로 유지하시며 자료다운, 문의등은 http://remiz.co.kr 를 이용해주시기 바랍니다.`);
      }

    });


    this.client.on("warn", (info) => console.log(info));
    this.client.on("error", console.error);

    this.onInteractionCreate();
  }

  private async registerSlashCommands() {
    const rest = new REST({ version: "9" }).setToken(config.TOKEN);

    const commandFiles = readdirSync(join(__dirname, "..", "commands")).filter((file) => !file.endsWith(".map"));

    for (const file of commandFiles) {
      const command = await import(join(__dirname, "..", "commands", `${file}`));

      this.slashCommands.push(command.default.data);
      this.slashCommandsMap.set(command.default.data.name, command.default);
    }

    await rest.put(Routes.applicationCommands(this.client.user!.id), { body: this.slashCommands });
  }

  private async onInteractionCreate() {
    this.client.on(Events.InteractionCreate, async (interaction: Interaction): Promise<any> => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.slashCommandsMap.get(interaction.commandName);

      if (!command) return;

      if (!this.cooldowns.has(interaction.commandName)) {
        this.cooldowns.set(interaction.commandName, new Collection());
      }

      const now = Date.now();
      const timestamps: any = this.cooldowns.get(interaction.commandName);
      const cooldownAmount = (command.cooldown || 1) * 1000;

      if (timestamps.has(interaction.user.id)) {
        const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

        if (now < expirationTime) {
          const timeLeft = (expirationTime - now) / 1000;
          return interaction.reply({
            content: i18n.__mf("common.cooldownMessage", {
              time: timeLeft.toFixed(1),
              name: interaction.commandName
            }),
            ephemeral: true
          });
        }
      }

      timestamps.set(interaction.user.id, now);
      setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

      try {
        const permissionsCheck: PermissionResult = await checkPermissions(command, interaction);

        if (permissionsCheck.result) {
          command.execute(interaction as ChatInputCommandInteraction);
        } else {
          throw new MissingPermissionsException(permissionsCheck.missing);
        }
      } catch (error: any) {
        console.error(error);

        if (error.message.includes("permissions")) {
          interaction.reply({ content: error.toString(), ephemeral: true }).catch(console.error);
        } else {
          interaction.reply({ content: i18n.__("common.errorCommand"), ephemeral: true }).catch(console.error);
        }
      }
    });
  }
}
